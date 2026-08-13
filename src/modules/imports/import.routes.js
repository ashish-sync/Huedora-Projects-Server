import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, AppError } from '../../utils/helpers.js';
import { importAppError } from '../../utils/importErrors.js';
import { PERMISSIONS } from '../../config/constants.js';
import { ImportJob } from './importJob.model.js';
import { Contact } from '../contacts/contact.model.js';
import { findContactByIdentity, resolveOrCreateContact } from '../contacts/contactIdentity.js';
import { DeviceMaster } from '../devices/device.model.js';
import { Asset } from '../assets/asset.model.js';
import { createAsset } from '../assets/asset.service.js';
import { normalizeSerialNumber, findActiveAssetBySerial } from '../assets/serialNumber.js';
import {
  normalizeAgreementStatus,
  normalizeDeviceCustody,
} from '../devices/device.constants.js';
import {
  VerificationCampaign,
  VerificationRecord,
} from '../verifications/verification.model.js';
import { writeAudit } from '../../utils/audit.js';
import { notifyImportFailures } from './importErrorReport.js';
import { normalizeEmail, normalizePhone } from '../../utils/identityNormalize.js';
import {
  assertSpreadsheetUpload,
  discardUploadBuffer,
  excelUpload,
  parseSheetRows,
} from '../../utils/masterExcel.js';
import { importRateLimiter } from '../../middleware/importRateLimit.js';
import { loadCappedRowsFromUpload } from './streaming/loadCappedRows.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission(PERMISSIONS.IMPORTS_EXECUTE));

function sheetRows(buffer) {
  return parseSheetRows(buffer);
}

function normKey(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
  }
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase().replace(/\s+/g, '') === c.toLowerCase().replace(/\s+/g, ''));
    if (found && row[found] !== '') return row[found];
  }
  return '';
}

async function processInventory(rows, mode, user) {
  const errors = [];
  let success = 0;
  const summary = { contacts: 0, devices: 0, assets: 0 };
  const seenSerials = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    try {
      const custodianKey = String(
        normKey(row, ['Custodian ID', 'Contact ID', 'HCW ID', 'hcwId', 'email', 'Email'])
      ).trim();
      const name = String(normKey(row, ['Name', 'name', 'Custodian Name'])).trim();
      const deviceName = String(normKey(row, ['Asset Name', 'Device Name', 'deviceName'])).trim();
      const serial = normalizeSerialNumber(
        normKey(row, ['Serial No', 'Serial Number', 'serialNumber']),
      );
      if (!name || !deviceName) {
        errors.push({
          row: rowNum,
          field: 'required',
          message: 'Custodian Name and Asset Name required',
        });
        continue;
      }
      if (serial) {
        if (seenSerials.has(serial)) {
          errors.push({
            row: rowNum,
            field: 'Serial Number',
            message: `Serial number “${serial}” is duplicated in this file`,
            code: 'SERIAL_EXISTS',
          });
          continue;
        }
        seenSerials.add(serial);
        const existingAsset = await findActiveAssetBySerial(serial);
        if (existingAsset) {
          errors.push({
            row: rowNum,
            field: 'Serial Number',
            message: `Serial number “${serial}” already exists`,
            code: 'SERIAL_EXISTS',
          });
          continue;
        }
      }

      if (mode === 'COMMIT') {
        const email =
          normalizeEmail(normKey(row, ['Email', 'email'])) ||
          (String(custodianKey).includes('@') ? normalizeEmail(custodianKey) : '');
        const phone =
          String(normKey(row, ['HCW Contact', 'Contact', 'Phone', 'Mobile'])).trim() ||
          (normalizePhone(custodianKey) ? String(custodianKey).trim() : '');
        const city = String(normKey(row, ['City'])).trim();

        let contact = await findContactByIdentity({ email, phone });
        if (!contact && custodianKey && !email && !normalizePhone(custodianKey)) {
          contact = await Contact.findOne({ _id: custodianKey, isDeleted: false });
        }
        if (!contact) {
          if (!email && !phone) {
            errors.push({
              row: rowNum,
              field: 'Email/Contact',
              message: 'Email or phone required to create or match a contact',
            });
            continue;
          }
          const resolved = await resolveOrCreateContact(
            {
              name,
              email,
              contact: phone,
              mobile: phone,
              city: city || undefined,
              resourceType: String(normKey(row, ['HCW Type', 'Resource Type']) || 'Full Timer'),
              profession: String(normKey(row, ['Profession']) || ''),
            },
            user._id
          );
          contact = resolved.contact;
          if (resolved.created) summary.contacts += 1;
        }

        const agreementStatus =
          normalizeAgreementStatus(normKey(row, ['Agreement Status'])) || 'Not Initiated';
        const custody = normalizeDeviceCustody(normKey(row, ['Device Custody', 'Custody']));

        let device = serial
          ? await DeviceMaster.findOne({ serialNumber: serial, isDeleted: false })
          : await DeviceMaster.findOne({ name: deviceName, isDeleted: false });
        if (!device) {
          device = await DeviceMaster.create({
            name: deviceName,
            serialNumber: serial || undefined,
            agreementStatus,
            custody: custody || undefined,
            createdBy: user._id,
          });
          summary.devices += 1;
        }

        const qty = Number(normKey(row, ['Device Quantity', 'quantity'])) || 1;
        await createAsset(
          {
            deviceMasterId: device._id,
            deviceNameSnapshot: deviceName,
            serialNumber: serial || undefined,
            quantity: qty,
            status: 'Purchased',
            contactId: contact._id,
            location: { city: city || contact.city || undefined },
            agreementStatus,
            remarks: String(normKey(row, ['Remarks']) || ''),
            custody: custody || undefined,
            addedMonth: String(normKey(row, ['Added Month']) || ''),
          },
          user
        );
        summary.assets += 1;
      }
      success += 1;
    } catch (err) {
      errors.push({ row: rowNum, field: 'import', message: err.message });
    }
  }

  return { success, errors, summary, total: rows.length };
}

async function processVerification(rows, mode, user) {
  const errors = [];
  let success = 0;
  const summary = { campaigns: 0, records: 0, serials: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    try {
      const periodRaw = String(normKey(row, ["Month'Year", 'MonthYear', 'periodKey'])).trim();
      const serial = normalizeSerialNumber(
        normKey(row, ['Serial No', 'Serial No.', 'serialNumber']),
      );
      if (!periodRaw) {
        errors.push({ row: rowNum, field: 'periodKey', message: "Month'Year required" });
        continue;
      }

      // Normalize display period to YYYY-MM when possible; else keep raw
      let periodKey = periodRaw;
      const m = periodRaw.match(/(\d{4})[-/](\d{1,2})/);
      if (m) periodKey = `${m[1]}-${String(m[2]).padStart(2, '0')}`;

      if (mode === 'COMMIT') {
        let campaign = await VerificationCampaign.findOne({ periodKey, isDeleted: false });
        if (!campaign) {
          campaign = await VerificationCampaign.create({
            periodKey,
            label: periodRaw,
            createdBy: user._id,
          });
          summary.campaigns += 1;
        }

        let asset = null;
        if (serial) {
          asset = await findActiveAssetBySerial(serial);
          if (!asset) {
            // try match by device name without serial enrichment create. skip create
          }
        }

        await VerificationRecord.create({
          campaignId: campaign._id,
          periodKey,
          srNo: Number(normKey(row, ['Sr. No.', 'Sr. No', 'srNo'])) || undefined,
          assetId: asset?._id || null,
          serialNumber: serial || undefined,
          brandModelTest: String(normKey(row, ['Brand-Model-Test', 'Brand Model Test'])),
          quantity: Number(normKey(row, ['Quantity'])) || 1,
          zone: String(normKey(row, ['Zone'])),
          currentLocation: String(normKey(row, ['Current Location'])),
          custodianName: String(normKey(row, ['Custodian Name'])),
          custodianContact: String(normKey(row, ['Custodian Contact'])),
          callRemark: String(normKey(row, ['Call Remark'])),
          round1: {
            verifiedOn: parseDate(normKey(row, ['I Verfication DD-MM-YY', 'I Verification DD-MM-YY'])),
            physical: mapPhysical(normKey(row, ['Physical'])),
            functionality: mapFunctionality(getNth(row, ['Functionality'], 0)),
          },
          round2: {
            verifiedOn: parseDate(normKey(row, ['II Verfication DD-MM-YY', 'II Verification DD-MM-YY'])),
            physical: mapPhysical(getNth(row, ['Physical'], 1)),
            functionality: mapFunctionality(getNth(row, ['Functionality'], 1)),
          },
          deviceValue: Number(normKey(row, ['Device Value'])) || undefined,
          finalStatus: String(normKey(row, ['Final Status'])),
          status: 'COMPLETED',
          createdBy: user._id,
        });
        summary.records += 1;
        if (serial) summary.serials += 1;
      }
      success += 1;
    } catch (err) {
      errors.push({ row: rowNum, field: 'import', message: err.message });
    }
  }

  return { success, errors, summary, total: rows.length };
}

function mapPhysical(v) {
  const s = String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (!s) return null;
  if (['PASS', 'P', 'YES', 'Y', 'OK'].includes(s)) return 'PASS';
  if (['FAIL', 'F', 'NO', 'N'].includes(s)) return 'FAIL';
  return null;
}

function mapFunctionality(v) {
  const s = String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (!s) return null;
  if (['CHECKED', 'CHECK', 'PASS', 'P', 'YES', 'Y', 'OK'].includes(s)) return 'CHECKED';
  if (['NOT_CHECKED', 'UNCHECKED', 'FAIL', 'F', 'NO', 'N'].includes(s)) return 'NOT_CHECKED';
  return null;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getNth(row, names, index) {
  const keys = Object.keys(row).filter((k) =>
    names.some((n) => k.toLowerCase().includes(n.toLowerCase()))
  );
  return keys[index] ? row[keys[index]] : '';
}

async function runImport(type, mode, req) {
  if (!req.file) throw importAppError('FILE_REQUIRED');
  const { rows, fileName } = await loadCappedRowsFromUpload(req.file);
  const job = await ImportJob.create({
    type,
    mode,
    status: 'RUNNING',
    phase: 'streaming',
    fileName,
    totalRows: rows.length,
    processedRows: 0,
    percent: 0,
    startedBy: req.user._id,
    idempotencyKey: req.headers['idempotency-key'] || undefined,
    startedAt: new Date().toISOString(),
  });

  try {
    const result =
      type === 'INVENTORY'
        ? await processInventory(rows, mode, req.user)
        : await processVerification(rows, mode, req.user);

    job.status = 'SUCCEEDED';
    job.phase = 'done';
    job.successRows = result.success;
    job.processedRows = rows.length;
    job.percent = 100;
    job.errorRows = result.errors.length;
    job.rowErrors = result.errors.slice(0, 500);
    job.summary = result.summary;
    job.finishedAt = new Date().toISOString();
    await job.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: mode === 'COMMIT' ? 'IMPORT.COMMIT' : 'IMPORT.DRY_RUN',
      entityType: 'ImportJob',
      entityId: job._id,
      after: { type, summary: result.summary, errors: result.errors.length },
      requestId: req.requestId,
    });

    if (result.errors.length) {
      const report = await notifyImportFailures({
        userId: req.user._id,
        importType: `${type}_${mode}`,
        sourceFileName: fileName,
        totalRows: rows.length,
        successRows: result.success,
        errors: result.errors,
        entityType: 'ImportJob',
        entityId: job._id,
      });
      if (report) {
        job.errorReport = {
          fileName: report.fileName,
          downloadPath: report.downloadPath,
          notificationId: report.notificationId,
        };
        await job.save();
      }
    }

    return job;
  } catch (err) {
    job.status = 'FAILED';
    job.phase = 'error';
    job.finishedAt = new Date().toISOString();
    job.rowErrors = [{ row: 0, field: 'system', message: err.message }];
    await job.save();
    throw err;
  }
}

router.post(
  '/inventory/dry-run',
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const job = await runImport('INVENTORY', 'DRY_RUN', req);
    res.json({ data: job });
  })
);

router.post(
  '/inventory/commit',
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const job = await runImport('INVENTORY', 'COMMIT', req);
    res.json({ data: job });
  })
);

router.post(
  '/verification/dry-run',
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const job = await runImport('VERIFICATION', 'DRY_RUN', req);
    res.json({ data: job });
  })
);

router.post(
  '/verification/commit',
  importRateLimiter,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    const job = await runImport('VERIFICATION', 'COMMIT', req);
    res.json({ data: job });
  })
);

router.get(
  '/jobs',
  asyncHandler(async (_req, res) => {
    const data = await ImportJob.find().sort({ startedAt: -1 }).limit(50);
    res.json({ data });
  })
);

router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await ImportJob.findById(req.params.id);
    if (!job) throw new AppError('Import job not found', 404);
    if (String(job.startedBy) !== String(req.user._id) && !req.user.isAdmin) {
      // allow same user; admins via permission already on router
    }
    res.json({
      data: {
        _id: job._id,
        type: job.type,
        mode: job.mode,
        status: job.status,
        phase: job.phase,
        fileName: job.fileName,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        successRows: job.successRows,
        errorRows: job.errorRows,
        percent: job.percent,
        summary: job.summary,
        rowErrors: (job.rowErrors || []).slice(0, 50),
        errorReport: job.errorReport,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    });
  })
);

export default router;
