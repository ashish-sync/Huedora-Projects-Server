import { CAMP_ONE_DEMO } from '../modules/campOps/campOps.seed.js';
import { User } from '../modules/users/user.model.js';
import { Contact } from '../modules/contacts/contact.model.js';
import {
  CampOpsCamp,
  CampOpsClient,
  CampOpsClientMaster,
} from '../modules/campOps/campOps.model.js';
import {
  LogisticsProduct,
  LogisticsSupplier,
} from '../modules/logistics/logistics.model.js';

/** Demo-only accounts created by Camp One / optional dev seeds. */
export const DEMO_USER_EMAILS = new Set([
  CAMP_ONE_DEMO.adminEmail.toLowerCase(),
  'manager@tylo.local',
  'verifier@tylo.local',
]);

export const DEMO_CONTACT_EMAILS = new Set([
  'ravi.tech@demo.tylo.local',
  'priya.sharma@citycare.example',
]);

export const DEMO_SUPPLIER_CODES = new Set(['DEMO-SUP', 'DEMO-VEN']);

export const DEMO_PRODUCT_CODES = new Set(['OT0001', 'MD0001']);
export const DEMO_PRODUCT_SKUS = new Set(['SKU-SEED01', 'SKU-SEED02']);

export const DEMO_TEMPLATE_NAMES = new Set([
  'Standard Device Lease',
  'Temporary Ownership / Custody',
  'Short-Term Demo Loan',
]);

const TEST_DOCTOR_CODE_PREFIXES = [
  'DEMO-',
  'E2E-',
  'QA-',
  'REF-',
  'TCPL-',
  'DBG-',
  'DBG2-',
  'DBG3-',
  'NOHCW-',
  'PASTE',
];

function isDemoCamp(camp = {}) {
  const doctorCode = String(camp.doctorCode || '').trim().toUpperCase();
  if (TEST_DOCTOR_CODE_PREFIXES.some((prefix) => doctorCode.startsWith(prefix))) return true;
  const doctorName = String(camp.doctorName || '').trim().toLowerCase();
  if (
    doctorName.includes('e2e test')
    || doctorName.includes('qa doctor')
    || doctorName.includes('paste demo')
    || doctorName.includes('debug')
  ) {
    return true;
  }
  if (String(camp.clientName || '').trim() === CAMP_ONE_DEMO.clientName) return true;
  if (String(camp.createdByEmail || '').trim().toLowerCase() === CAMP_ONE_DEMO.adminEmail) return true;
  return false;
}

function isDemoClient(client = {}) {
  const name = String(client.name || '').trim();
  const code = String(client.code || '').trim().toUpperCase();
  return name === CAMP_ONE_DEMO.clientName || code === CAMP_ONE_DEMO.clientCode;
}

function isDemoClientMaster(row = {}) {
  const clientName = String(row.clientName || '').trim();
  const program = String(row.programName || '').trim();
  return clientName === CAMP_ONE_DEMO.clientName
    || program === 'Demo Screening Program'
    || /^E2E\b/i.test(program);
}

function isDemoContact(contact = {}) {
  const email = String(contact.email || '').trim().toLowerCase();
  if (DEMO_CONTACT_EMAILS.has(email)) return true;
  if (email.endsWith('@demo.tylo.local')) return true;
  return false;
}

function isDemoProduct(product = {}) {
  const code = String(product.code || '').trim().toUpperCase();
  const sku = String(product.sku || '').trim().toUpperCase();
  return DEMO_PRODUCT_CODES.has(code) || DEMO_PRODUCT_SKUS.has(sku);
}

function isDemoSupplier(supplier = {}) {
  const code = String(supplier.code || '').trim().toUpperCase();
  return DEMO_SUPPLIER_CODES.has(code);
}

function isDemoAuditEntry(entry = {}) {
  const blob = JSON.stringify(entry || {}).toLowerCase();
  return blob.includes('demo pharma')
    || blob.includes('demo-')
    || blob.includes('campadmin@tylo.local')
    || blob.includes('@demo.tylo.local')
    || blob.includes('priya.sharma@citycare.example')
    || blob.includes('qa-dash-')
    || blob.includes('qa-paste-')
    || blob.includes('qa-xls-')
    || blob.includes('qa-parse-')
    || blob.includes('e2e-')
    || blob.includes('utr-qa-');
}

/**
 * Remove demo / test records while preserving production-safe master data
 * (roles, geo masters, logistics lookups, templates, finance profile, real users).
 */
export async function purgeDemoData({ dryRun = false } = {}) {
  const summary = {
    dryRun,
    removed: {},
    preserved: {},
  };

  async function removeDocs(label, docs, removeFn) {
    if (!docs.length) {
      summary.removed[label] = 0;
      return;
    }
    if (dryRun) {
      summary.removed[label] = docs.length;
      return;
    }
    await removeFn(docs);
    summary.removed[label] = docs.length;
  }

  async function softDeleteDoc(model, doc) {
    if (model.updateOne) {
      await model.updateOne(
        { _id: doc._id },
        { $set: { isDeleted: true, deletedAt: new Date().toISOString() } },
      );
      return;
    }
    await rewriteCollectionKeeping(model, (row) => String(row._id) !== String(doc._id));
  }

  async function rewriteCollectionKeeping(model, shouldKeep) {
    const rows = await model.find({});
    const kept = rows.filter((row) => shouldKeep(row));
    if (kept.length === rows.length) return;
    await model.deleteMany();
    for (const row of kept) {
      const plain = typeof row?.toObject === 'function' ? row.toObject() : { ...row };
      await model.create(plain);
    }
  }

  const demoUsers = (await User.find({})).filter((user) => (
    DEMO_USER_EMAILS.has(String(user.email || '').trim().toLowerCase())
  ));
  await removeDocs('users', demoUsers, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(User, doc);
    }
  });

  const demoClients = (await CampOpsClient.find({ isDeleted: false })).filter(isDemoClient);
  const demoClientIds = new Set(demoClients.map((client) => String(client._id)));
  await removeDocs('camp_ops_clients', demoClients, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(CampOpsClient, doc);
    }
  });

  const demoMasters = (await CampOpsClientMaster.find({ isDeleted: false })).filter((row) => (
    isDemoClientMaster(row) || demoClientIds.has(String(row.clientId))
  ));
  await removeDocs('camp_ops_client_masters', demoMasters, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(CampOpsClientMaster, doc);
    }
  });

  const demoCamps = (await CampOpsCamp.find({ isDeleted: false })).filter((camp) => (
    isDemoCamp(camp) || demoClientIds.has(String(camp.clientId))
  ));
  await removeDocs('camp_ops_camps', demoCamps, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(CampOpsCamp, doc);
    }
  });

  const demoContacts = (await Contact.find({ isDeleted: false })).filter(isDemoContact);
  await removeDocs('contacts', demoContacts, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(Contact, doc);
    }
  });

  const demoProducts = (await LogisticsProduct.find({ isDeleted: false })).filter(isDemoProduct);
  await removeDocs('logistics_products', demoProducts, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(LogisticsProduct, doc);
    }
  });

  const demoSuppliers = (await LogisticsSupplier.find({ isDeleted: false })).filter(isDemoSupplier);
  await removeDocs('logistics_suppliers', demoSuppliers, async (docs) => {
    for (const doc of docs) {
      await softDeleteDoc(LogisticsSupplier, doc);
    }
  });

  // Optional agreement sample templates (only when explicitly seeded)
  try {
    const { DocumentTemplate } = await import('../modules/templates/template.model.js');
    const demoTemplates = (await DocumentTemplate.find({ isDeleted: false })).filter((row) => (
      DEMO_TEMPLATE_NAMES.has(String(row.name || '').trim())
    ));
    await removeDocs('document_templates', demoTemplates, async (docs) => {
      for (const doc of docs) {
        await softDeleteDoc(DocumentTemplate, doc);
      }
    });
  } catch {
    summary.removed.document_templates = 0;
  }

  // Test persistence JSON artifacts (file store only)
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { dataDir } = await import('../config/paths.js');
    for (const name of ['__persist_test.json', '__verify_roundtrip.json']) {
      const filePath = path.join(dataDir, name);
      if (!fs.existsSync(filePath)) {
        summary.removed[name] = 0;
        continue;
      }
      if (dryRun) {
        summary.removed[name] = 1;
      } else {
        fs.unlinkSync(filePath);
        summary.removed[name] = 1;
      }
    }
  } catch {
    // ignore
  }

  // Builder / commercial docs created during local QA (file-store only noise)
  try {
    const { FinanceCommercialDocument } = await import('../modules/finance/finance.model.js');
    const commercial = await FinanceCommercialDocument.find({ isDeleted: false });
    const demoCommercial = commercial.filter((row) => {
      const blob = JSON.stringify(row || {}).toLowerCase();
      return blob.includes('demo pharma')
        || blob.includes('@demo.tylo.local')
        || blob.includes('campadmin@tylo.local')
        || blob.includes('e2e billing')
        || blob.includes('qa doctor');
    });
    await removeDocs('finance_commercial_documents', demoCommercial, async (docs) => {
      for (const doc of docs) {
        await softDeleteDoc(FinanceCommercialDocument, doc);
      }
    });
  } catch {
    summary.removed.finance_commercial_documents = 0;
  }

  // Dev audit noise tied to demo entities
  try {
    const { AuditLog } = await import('../modules/audit/audit.model.js');
    const audits = await AuditLog.find({});
    const demoAudits = audits.filter(isDemoAuditEntry);
    await removeDocs('audit_logs', demoAudits, async () => {
      if (!dryRun) {
        await rewriteCollectionKeeping(AuditLog, (row) => !isDemoAuditEntry(row));
      }
    });
  } catch {
    summary.removed.audit_logs = 0;
  }

  summary.preserved = {
    roles: await countSafe(async () => {
      const { Role } = await import('../modules/users/role.model.js');
      return Role.countDocuments({ isDeleted: false });
    }),
    geo_states: await countSafe(async () => {
      const { GeoState } = await import('../modules/geo/geo.model.js');
      return GeoState.countDocuments({ isDeleted: false });
    }),
    logistics_uoms: await countSafe(async () => {
      const { LogisticsUom } = await import('../modules/logistics/logistics.model.js');
      return LogisticsUom.countDocuments({ isDeleted: false });
    }),
    users: await User.countDocuments({ isDeleted: false }),
    camp_ops_clients: await CampOpsClient.countDocuments({ isDeleted: false }),
    camp_ops_camps: await CampOpsCamp.countDocuments({ isDeleted: false }),
  };

  return summary;
}

async function countSafe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}
