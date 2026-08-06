import { Router } from 'express';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.js';
import { asyncHandler, AppError, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import { cellValue, excelUpload, parseSheetRows, assertSpreadsheetUpload, discardUploadBuffer } from '../../utils/masterExcel.js';
import { forceReseedGeoMasters } from './geo.seed.js';
import { resolveZoneForStateRecord, resolveZoneNameForState } from './geo.zones.js';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState, GeoZone } from './geo.model.js';
import { PIN_CODE_HEADERS, PIN_CODE_IMPORT_HEADERS, PIN_CODE_SAMPLE_ROWS } from './pinCodes.excel.js';
import {
  attachPinCounts,
  bulkImportPinRows,
  enrichPinRecord,
  enrichPinRecords,
  getPinPreview,
  pinToExcelRow,
  resolvePinTargets,
  upsertNormalizedPin,
} from './pinCode.service.js';
import { autocompletePlaces, getPlaceDetails } from './places.service.js';
import { escapeRegex } from '../../utils/escapeRegex.js';

const router = Router();
router.use(authenticate);

const canReadGeo = requirePermission(
  PERMISSIONS.LOGISTICS_READ,
  PERMISSIONS.LOGISTICS_MASTER,
  PERMISSIONS.MASTERS_READ,
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE
);
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/places/')) return next();
  return canReadGeo(req, res, next);
});

const canUsePlaces = requirePermission(
  PERMISSIONS.CAMPS_READ,
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE,
  PERMISSIONS.LOGISTICS_WRITE,
  PERMISSIONS.AGREEMENTS_WRITE
);

const canWritePinGeography = requirePermission(
  PERMISSIONS.CAMPS_REQUEST,
  PERMISSIONS.CAMPS_APPROVE,
  PERMISSIONS.LOGISTICS_MASTER,
  PERMISSIONS.AGREEMENTS_WRITE,
  PERMISSIONS.USERS_WRITE,
  PERMISSIONS.ALL
);

function publicRow(row) {
  if (!row) return null;
  const o = row.toObject ? row.toObject() : { ...row };
  return o;
}

/** POST /geo/reseed — reload states, districts, cities, zones from bundled seed */
router.post(
  '/reseed',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await forceReseedGeoMasters();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'GEO.RESEED',
      entityType: 'GeoMaster',
      entityId: 'india-geo',
      after: result,
      requestId: req.requestId,
    });
    res.json({ data: result });
  })
);

/** GET /geo/meta — counts + source attribution */
router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const [states, districts, cities, pinCodes] = await Promise.all([
      GeoState.countDocuments({ isDeleted: false, isActive: true }),
      GeoDistrict.countDocuments({ isDeleted: false, isActive: true }),
      GeoCity.countDocuments({ isDeleted: false, isActive: true }),
      GeoPinCode.countDocuments({ isDeleted: false, isActive: true }),
    ]);
    res.json({
      data: {
        country: 'IN',
        countryName: 'India',
        counts: { states, districts, cities, pinCodes },
        sources: [
          'dr5hn/countries-states-cities-database (states + cities)',
          'sab99r/Indian-States-And-Districts (districts; CSC has no district layer)',
          'PIN codes: local admin master (starts empty)',
        ],
      },
    });
  })
);

/** GET /geo/zones */
router.get(
  '/zones',
  asyncHandler(async (_req, res) => {
    const rows = await GeoZone.find({ isDeleted: false, isActive: true }).sort('sortOrder');
    res.json({ data: rows.map(publicRow) });
  })
);

/** GET /geo/zones/resolve?stateId=&stateName= */
router.get(
  '/zones/resolve',
  asyncHandler(async (req, res) => {
    const stateId = String(req.query.stateId || '').trim();
    const stateName = String(req.query.stateName || '').trim();
    let resolvedName = stateName;
    if (stateId) {
      const st = await GeoState.findOne({ _id: stateId, isDeleted: false, isActive: true });
      if (!st) throw new AppError('State not found', 404, 'NOT_FOUND');
      resolvedName = st.name;
    }
    if (!resolvedName) throw new AppError('stateId or stateName is required', 400, 'VALIDATION_ERROR');
    const zones = await GeoZone.find({ isDeleted: false, isActive: true });
    const match = resolveZoneForStateRecord(resolvedName, zones);
    res.json({ data: match || { zone: '', zoneId: '' } });
  })
);

/** GET /geo/states */
router.get(
  '/states',
  asyncHandler(async (req, res) => {
    const filter = { isDeleted: false, isActive: true };
    if (req.query.q) filter.name = new RegExp(escapeRegex(String(req.query.q)), 'i');
    const rows = await GeoState.find(filter).sort('name').limit(100);
    let data = rows.map(publicRow);
    if (req.query.includePinStats === 'true') {
      data = await attachPinCounts(data, 'stateId');
    }
    res.json({ data });
  })
);

/** GET /geo/districts?stateId= */
router.get(
  '/districts',
  asyncHandler(async (req, res) => {
    const stateId = String(req.query.stateId || '').trim();
    if (!stateId) throw new AppError('stateId is required', 400, 'VALIDATION_ERROR');
    const filter = { isDeleted: false, isActive: true, stateId };
    if (req.query.q) filter.name = new RegExp(escapeRegex(String(req.query.q)), 'i');
    const rows = await GeoDistrict.find(filter).sort('name').limit(500);
    let data = rows.map(publicRow);
    if (req.query.includePinStats === 'true') {
      data = await attachPinCounts(data, 'districtId');
    }
    res.json({ data });
  })
);

/**
 * GET /geo/cities?stateId=&districtId=
 * When districtId is set: cities linked to that district, plus unassigned cities in the state
 * (so towns without a district mapping remain selectable).
 */
router.get(
  '/cities',
  asyncHandler(async (req, res) => {
    const stateId = String(req.query.stateId || '').trim();
    if (!stateId) throw new AppError('stateId is required', 400, 'VALIDATION_ERROR');
    const districtId = String(req.query.districtId || '').trim();
    const q = String(req.query.q || '').trim();

    let rows;
    if (districtId) {
      const allInState = await GeoCity.find({ isDeleted: false, isActive: true, stateId })
        .sort('name')
        .limit(5000);
      rows = allInState.filter(
        (c) =>
          String(c.districtId || '') === String(districtId) ||
          c.districtId == null ||
          c.districtId === ''
      );
    } else {
      rows = await GeoCity.find({ isDeleted: false, isActive: true, stateId }).sort('name').limit(5000);
    }

    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      rows = rows.filter((c) => re.test(c.name));
    }

    let data = rows.map(publicRow);
    if (req.query.includePinStats === 'true') {
      data = await attachPinCounts(data, 'cityId');
    }
    res.json({ data });
  })
);

/** GET /geo/pin-codes?cityId=&stateId=&districtId=&q=&pinCode= */
router.get(
  '/pin-codes/preview',
  asyncHandler(async (req, res) => {
    const data = await getPinPreview({
      stateId: req.query.stateId,
      districtId: req.query.districtId,
      cityId: req.query.cityId,
      limit: Math.min(Number(req.query.limit) || 3, 10),
      active: req.query.active !== 'false',
    });
    res.json({ data });
  })
);

router.get(
  '/pin-codes',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.active !== 'false') filter.isActive = true;
    if (req.query.cityId) filter.cityId = String(req.query.cityId);
    if (req.query.districtId) filter.districtId = String(req.query.districtId);
    if (req.query.stateId) filter.stateId = String(req.query.stateId);
    if (req.query.pinCode) filter.pinCode = String(req.query.pinCode).trim();
    if (req.query.q) {
      const term = String(req.query.q).trim();
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const [matchingStates, matchingDistricts, matchingCities] = await Promise.all([
        GeoState.find({ isDeleted: false, name: re }),
        GeoDistrict.find({ isDeleted: false, name: re }),
        GeoCity.find({ isDeleted: false, name: re }),
      ]);
      const or = [{ pinCode: re }];
      if (matchingStates.length) {
        or.push({ stateId: { $in: matchingStates.map((s) => s._id) } });
      }
      if (matchingDistricts.length) {
        or.push({ districtId: { $in: matchingDistricts.map((d) => d._id) } });
      }
      if (matchingCities.length) {
        or.push({ cityId: { $in: matchingCities.map((c) => c._id) } });
      }
      filter.$or = or;
    }
    const [raw, total] = await Promise.all([
      GeoPinCode.find(filter)
        .sort(sort || 'pinCode')
        .skip(skip)
        .limit(limit),
      GeoPinCode.countDocuments(filter),
    ]);
    const data = await enrichPinRecords(raw);
    res.json(paginated(data, total, page, limit));
  })
);

router.get(
  '/pin-codes/export',
  asyncHandler(async (_req, res) => {
    const rows = await GeoPinCode.find({ isDeleted: false }).sort('pinCode');
    const enriched = await enrichPinRecords(rows);
    sendExcel(
      res,
      'Pin_Code_Master.xlsx',
      PIN_CODE_HEADERS,
      enriched.map(pinToExcelRow),
      { sheetName: 'PIN Codes' }
    );
  })
);

router.get(
  '/pin-codes/sample',
  asyncHandler(async (_req, res) => {
    sendExcel(
      res,
      'Pin_Code_Master_Sample.xlsx',
      PIN_CODE_IMPORT_HEADERS,
      PIN_CODE_SAMPLE_ROWS,
      { sheetName: 'PIN Codes' }
    );
  })
);

router.post(
  '/pin-codes/import',
  canWritePinGeography,
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    assertSpreadsheetUpload(req.file);
    const rows = parseSheetRows(req.file.buffer);
    discardUploadBuffer(req.file);
    const parsedRows = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const pinCode = String(cellValue(row, ['PIN Code', 'PIN', 'pinCode'])).replace(/\D+/g, '');
      if (!pinCode) continue;
      const activeRaw = cellValue(row, ['Active', 'Status', 'isActive']);
      parsedRows.push({
        rowNum: i + 2,
        pinCode,
        stateName: cellValue(row, ['State', 'stateName']),
        districtName: cellValue(row, ['District', 'District Name', 'districtName']),
        cityName: cellValue(row, ['City', 'cityName']),
        locality: cellValue(row, ['Locality', 'locality']),
        notes: cellValue(row, ['Notes', 'notes']),
        isActive: !['no', 'false', '0', 'inactive'].includes(String(activeRaw).toLowerCase()),
      });
    }

    const { created, updated, skipped, errors, totalRows } = await bulkImportPinRows(parsedRows, {
      updatedBy: req.user._id,
    });

    res.json({
      data: {
        totalRows,
        created,
        updated,
        skipped,
        errorRows: errors.length,
        errors: errors.slice(0, 200),
      },
    });
  })
);

function enrichPinRow(row, zones = []) {
  return enrichPinRecord(row).then((o) => {
    if (!o) return null;
    const zm = resolveZoneForStateRecord(o.stateName, zones);
    return {
      ...o,
      zone: zm?.zone || resolveZoneNameForState(o.stateName),
      zoneId: zm?.zoneId || '',
    };
  });
}

/** GET /geo/pin-codes/lookup/:pin — local master; includes city, state, zone */
router.get(
  '/pin-codes/lookup/:pin',
  asyncHandler(async (req, res) => {
    const pin = String(req.params.pin || '').replace(/\D+/g, '');
    if (pin.length !== 6) throw new AppError('PIN code must be 6 digits', 400, 'VALIDATION_ERROR');
    const [rows, zones] = await Promise.all([
      GeoPinCode.find({ pinCode: pin, isDeleted: false, isActive: true }).limit(20),
      GeoZone.find({ isDeleted: false, isActive: true }),
    ]);
    const data = (await Promise.all(rows.map((row) => enrichPinRow(row, zones)))).filter(Boolean);
    res.json({ data, resolved: data[0] || null });
  })
);

/** GET /geo/places/autocomplete?input=... — Google Places (New) via server key */
router.get(
  '/places/autocomplete',
  canUsePlaces,
  asyncHandler(async (req, res) => {
    const input = String(req.query.input || '').trim();
    const data = await autocompletePlaces(input);
    res.json({ data });
  })
);

/** GET /geo/places/details?placeId=... */
router.get(
  '/places/details',
  canUsePlaces,
  asyncHandler(async (req, res) => {
    const data = await getPlaceDetails(req.query.placeId);
    res.json({ data });
  })
);

router.post(
  '/pin-codes',
  canWritePinGeography,
  asyncHandler(async (req, res) => {
    const pinCode = String(req.body.pinCode || '').replace(/\D+/g, '');
    const { city, district, state } = await resolvePinTargets(req.body);
    const { row, created } = await upsertNormalizedPin({
      pinCode,
      city,
      district,
      state,
      locality: req.body.locality,
      notes: req.body.notes,
      isActive: req.body.isActive !== false,
      updatedBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: created ? 'GEO_PIN.CREATE' : 'GEO_PIN.UPDATE',
      entityType: 'GeoPinCode',
      entityId: row._id,
      after: await enrichPinRecord(row),
      requestId: req.requestId,
    });

    res.status(created ? 201 : 200).json({ data: await enrichPinRecord(row) });
  })
);

router.patch(
  '/pin-codes/:id',
  canWritePinGeography,
  asyncHandler(async (req, res) => {
    const row = await GeoPinCode.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('PIN code mapping not found', 404);

    const pinCode =
      req.body.pinCode !== undefined
        ? String(req.body.pinCode || '').replace(/\D+/g, '')
        : row.pinCode;

    let city;
    let district;
    let state;
    if (req.body.cityId || req.body.districtId || req.body.stateId) {
      ({ city, district, state } = await resolvePinTargets({
        cityId: req.body.cityId || row.cityId,
        districtId: req.body.districtId || row.districtId,
        stateId: req.body.stateId || row.stateId,
      }));
    } else {
      ({ city, district, state } = await resolvePinTargets({
        cityId: row.cityId,
        districtId: row.districtId,
        stateId: row.stateId,
      }));
    }

    const { row: saved } = await upsertNormalizedPin({
      pinCode,
      city,
      district,
      state,
      locality: req.body.locality !== undefined ? req.body.locality : row.locality,
      notes: req.body.notes !== undefined ? req.body.notes : row.notes,
      isActive: req.body.isActive !== undefined ? req.body.isActive : row.isActive,
      updatedBy: req.user._id,
      existingId: row._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'GEO_PIN.UPDATE',
      entityType: 'GeoPinCode',
      entityId: saved._id,
      after: await enrichPinRecord(saved),
      requestId: req.requestId,
    });

    res.json({ data: await enrichPinRecord(saved) });
  })
);

router.delete(
  '/pin-codes/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await GeoPinCode.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('PIN code mapping not found', 404);
    row.isDeleted = true;
    row.isActive = false;
    row.updatedBy = req.user._id;
    await row.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'GEO_PIN.DELETE',
      entityType: 'GeoPinCode',
      entityId: row._id,
      requestId: req.requestId,
    });
    res.json({ data: { ok: true } });
  })
);

export default router;
