/**
 * One-shot: register Downloads/Service Agreement.docx as a Document Template
 * with repeatable Asset Issued table metadata.
 *
 * Usage (from server/): node scripts/seed-service-agreement-template.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { uploadDir } from '../src/config/paths.js';
import { DocumentTemplate } from '../src/modules/templates/template.model.js';
import {
  analyzeDocx,
  ensureDir,
  writeBuffer,
} from '../src/modules/templates/docxPlaceholders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = path.resolve('C:/Users/ashishs/Downloads/Service Agreement.docx');
const src = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SRC;
const TEMPLATE_NAME = 'Service Agreement';

async function main() {
  if (!fs.existsSync(src)) {
    console.error('File not found:', src);
    process.exit(1);
  }

  await connectDb();
  const buffer = fs.readFileSync(src);
  const analysis = await analyzeDocx(buffer);

  console.log('Document fields:', analysis.placeholders.map((p) => p.token).join(', '));
  console.log(
    'Repeatable tables:',
    analysis.repeatableTables.map((t) => `${t.id} (${t.columns.map((c) => c.token).join(', ')})`).join(' | ') || '(none)'
  );

  const templateRoot = uploadDir('templates');
  ensureDir(templateRoot);
  const originalFileName = path.basename(src);
  const storageKey = `${uuid()}-${originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  writeBuffer(path.join(templateRoot, storageKey), buffer);

  const existing = await DocumentTemplate.find({
    name: TEMPLATE_NAME,
    isDeleted: false,
  });
  for (const row of existing) {
    row.isActive = false;
    row.isDeleted = true;
    row.deletedAt = new Date();
    await row.save();
    console.log('Deactivated previous:', row._id);
  }

  const tpl = await DocumentTemplate.create({
    name: TEMPLATE_NAME,
    category: 'AGREEMENT',
    agreementType: 'LEASE',
    documentType: 'OTHER',
    signingType: 'SIGNING',
    description: 'HCW service agreement · repeatable Asset Issued table',
    bodyHtml: analysis.plain,
    sourceType: 'DOCX',
    originalFileName,
    storageKey,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    placeholders: analysis.placeholders || [],
    repeatableTables: analysis.repeatableTables || [],
    isActive: true,
  });

  // Keep a copy under client samples for local reference
  const sampleDir = path.resolve(__dirname, '../../client/public/samples');
  ensureDir(sampleDir);
  const samplePath = path.join(sampleDir, 'Service_Agreement.docx');
  fs.copyFileSync(src, samplePath);

  console.log('Created template:', tpl._id);
  console.log('File:', storageKey);
  console.log('Sample copy:', samplePath);
  console.log('Open Master One → Document Templates, or create an agreement and pick "Service Agreement".');
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
