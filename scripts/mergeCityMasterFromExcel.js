/**
 * Merge an operational city workbook into city-master.json.
 *
 * Existing master names stay canonical (no renames, no deletions).
 * Excel spelling variants / twin-city labels are treated as matches.
 * Only unmatched cities are appended.
 *
 * Usage: node scripts/mergeCityMasterFromExcel.js "C:/path/City List.xlsx"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cityMasterPath = path.resolve(__dirname, '../src/modules/geo/seed/city-master.json');

const CITY_COL = 'City / Town';
const DISTRICT_COL = 'District (current/common name)';

/** Excel name (after normalize) → existing master name. Same-state only via the key prefix. */
const MASTER_ALIASES = {
  'andhra pradesh|rajamahendravaram': 'Rajahmundry',
  'bihar|arrah': 'Ara',
  'jharkhand|bokaro steel city': 'Bokaro',
  'karnataka|hubballi dharwad': 'Hubballi',
  'karnataka|gadag betageri': 'Gadag',
  'karnataka|doddaballapura': 'Doddaballapur',
  'karnataka|hospet': 'Hosapete',
  'karnataka|chikkamagaluru': 'Chikmagalur',
  'madhya pradesh|murwara katni': 'Katni',
  'maharashtra|sangli miraj kupwad': 'Sangli',
  'maharashtra|chhatrapati sambhajinagar': 'Sambhajinagar',
  'maharashtra|osmanabad dharashiv': 'Dharashiv',
  'odisha|brahmapur': 'Berhampur',
};

/** Excel-internal renamed duplicates that are not yet in the master. Keep the current official name. */
const SKIP_INCOMING = new Set([
  'madhya pradesh|hoshangabad',
]);

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cityKey(stateName, cityName) {
  return `${norm(stateName)}|${norm(cityName)}`;
}

function readExcelRows(excelPath) {
  const workbook = xlsx.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const stateName = String(row.State || '').trim();
    const name = String(row[CITY_COL] || '').trim();
    const districtName = String(row[DISTRICT_COL] || '').trim();
    if (!stateName || !name) continue;
    const key = cityKey(stateName, name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ stateName, name, districtName });
  }

  return unique;
}

function sortCities(rows) {
  return [...rows].sort((a, b) => {
    const stateCmp = a.stateName.localeCompare(b.stateName);
    return stateCmp !== 0 ? stateCmp : a.name.localeCompare(b.name);
  });
}

function serializeCity(row) {
  const next = { name: row.name, stateName: row.stateName };
  if (row.districtName) next.districtName = row.districtName;
  return next;
}

function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    throw new Error('Usage: node scripts/mergeCityMasterFromExcel.js "<City List.xlsx>"');
  }
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Excel file not found: ${excelPath}`);
  }

  const existing = JSON.parse(fs.readFileSync(cityMasterPath, 'utf8'));
  const byKey = new Map();
  for (const row of existing) {
    byKey.set(cityKey(row.stateName, row.name), { ...row });
  }

  const excelRows = readExcelRows(excelPath);
  const matched = [];
  const added = [];
  const skippedVariants = [];

  for (const row of excelRows) {
    const incomingKey = cityKey(row.stateName, row.name);
    if (SKIP_INCOMING.has(incomingKey)) {
      skippedVariants.push({ excel: row.name, stateName: row.stateName, reason: 'renamed-duplicate' });
      continue;
    }

    const aliasName = MASTER_ALIASES[incomingKey];
    const canonicalName = aliasName || row.name;
    const existingKey = cityKey(row.stateName, canonicalName);
    const current = byKey.get(existingKey);

    if (current) {
      if (row.districtName && !current.districtName) {
        current.districtName = row.districtName;
        byKey.set(existingKey, current);
      }
      matched.push({
        excel: row.name,
        kept: current.name,
        variant: Boolean(aliasName),
      });
      if (aliasName) {
        skippedVariants.push({
          excel: row.name,
          stateName: row.stateName,
          reason: `alias-of:${current.name}`,
        });
      }
      continue;
    }

    const next = serializeCity({
      name: row.name,
      stateName: row.stateName,
      districtName: row.districtName,
    });
    byKey.set(incomingKey, next);
    added.push(next);
  }

  const merged = sortCities([...byKey.values()]).map(serializeCity);
  fs.writeFileSync(cityMasterPath, `${JSON.stringify(merged, null, 2)}\n`);

  const byStateAdded = {};
  for (const row of added) {
    byStateAdded[row.stateName] = (byStateAdded[row.stateName] || 0) + 1;
  }

  console.log(JSON.stringify({
    excelUnique: excelRows.length,
    existingBefore: existing.length,
    matchedExisting: matched.length,
    skippedVariants: skippedVariants.length,
    added: added.length,
    existingAfter: merged.length,
    addedByState: byStateAdded,
    skippedVariants,
  }, null, 2));
}

main();
