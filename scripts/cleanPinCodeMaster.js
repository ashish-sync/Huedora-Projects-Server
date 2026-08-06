#!/usr/bin/env node
/**
 * Clean PIN Code Master — verify/correct City, District, State, Zone against GoI geo seed.
 *
 * Usage:
 *   node scripts/cleanPinCodeMaster.js [input.xlsx] [outputDir]
 *
 * Defaults:
 *   input:  ~/Downloads/Pin Code Master.xlsx
 *   output: server/data/exports/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import geoSeed from '../src/modules/geo/seed/india-geo.json' with { type: 'json' };
import { withUtf8Bom } from '../src/utils/csvEncoding.js';
import {
  buildGeoResolverIndexes,
  normalizePinGeoRow,
  normGeoKey,
} from '../src/modules/geo/pinCodeGeoNormalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'Pin Code Master.xlsx');
const inputPath = path.resolve(process.argv[2] || defaultInput);
const outputDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'exports'));

function readPinRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.includes('PIN Codes')
    ? 'PIN Codes'
    : workbook.SheetNames[0];
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  return rawRows.map((row, index) => ({
    rowNum: index + 2,
    pinCode: String(row['PIN Code'] || row.PIN || row.pinCode || '').replace(/\D+/g, ''),
    stateName: String(row.State || row.stateName || '').trim(),
    districtName: String(row.District || row.districtName || '').trim(),
    zoneName: String(row.Zone || row.zoneName || '').trim(),
    cityName: String(row.City || row.cityName || '').trim(),
  })).filter((row) => row.pinCode);
}

function dedupeByPin(rows) {
  const byPin = new Map();
  for (const row of rows) {
    const pin = row.pinCode.padStart(6, '0').slice(-6);
    if (!byPin.has(pin)) byPin.set(pin, row);
  }
  return [...byPin.values()].sort((a, b) => a.pinCode.localeCompare(b.pinCode));
}

function toCsv(rows) {
  const headers = ['pinCode', 'state', 'zone', 'district', 'city'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => {
      const value = String(row[key === 'pinCode' ? 'pinCode' : key] || '');
      return value.includes(',') ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(','));
  }
  return withUtf8Bom(`${lines.join('\n')}\n`);
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const indexes = buildGeoResolverIndexes(geoSeed);
  const rawRows = readPinRows(inputPath);
  const uniqueRows = dedupeByPin(rawRows);

  const cleaned = [];
  const corrections = [];
  const errors = [];

  for (const row of uniqueRows) {
    const result = normalizePinGeoRow(row, indexes);
    if (!result.ok) {
      errors.push({ rowNum: row.rowNum, pinCode: row.pinCode, message: result.error });
      continue;
    }

    const outputRow = {
      pinCode: result.pinCode,
      state: result.state,
      zone: result.zone,
      district: result.district,
      city: result.city,
    };
    cleaned.push(outputRow);

    const changedFields = Object.entries(result.changed)
      .filter(([, changed]) => changed)
      .map(([field]) => field);
    if (changedFields.length) {
      corrections.push({
        pinCode: result.pinCode,
        changedFields,
        before: {
          state: row.stateName,
          zone: row.zoneName,
          district: row.districtName,
          city: row.cityName,
        },
        after: outputRow,
      });
    }
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const baseName = `pin-code-master-cleaned-${timestamp}`;
  const xlsxPath = path.join(outputDir, `${baseName}.xlsx`);
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const csvPath = path.join(outputDir, `${baseName}.csv`);
  const reportPath = path.join(outputDir, `${baseName}-report.json`);

  const excelRows = cleaned.map((row) => ({
    'PIN Code': row.pinCode,
    State: row.state,
    Zone: row.zone,
    District: row.district,
    City: row.city,
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(excelRows, {
    header: ['PIN Code', 'State', 'Zone', 'District', 'City'],
  });
  XLSX.utils.book_append_sheet(workbook, worksheet, 'PIN Codes');
  XLSX.writeFile(workbook, xlsxPath);

  fs.writeFileSync(jsonPath, `${JSON.stringify(cleaned, null, 2)}\n`);
  fs.writeFileSync(csvPath, toCsv(cleaned));
  fs.writeFileSync(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFile: inputPath,
    inputRows: rawRows.length,
    uniquePins: uniqueRows.length,
    cleanedRows: cleaned.length,
    correctedRows: corrections.length,
    errorRows: errors.length,
    corrections: corrections.slice(0, 500),
    errors,
  }, null, 2)}\n`);

  console.log('PIN Code Master cleaned successfully');
  console.log(`Source rows:     ${rawRows.length}`);
  console.log(`Unique PINs:     ${uniqueRows.length}`);
  console.log(`Cleaned rows:    ${cleaned.length}`);
  console.log(`Corrected rows:  ${corrections.length}`);
  console.log(`Error rows:      ${errors.length}`);
  console.log('');
  console.log(`Excel:  ${xlsxPath}`);
  console.log(`JSON:   ${jsonPath}`);
  console.log(`CSV:    ${csvPath}`);
  console.log(`Report: ${reportPath}`);

  if (errors.length) {
    console.log('\nUnresolved rows (first 10):');
    for (const err of errors.slice(0, 10)) {
      console.log(`  PIN ${err.pinCode} (row ${err.rowNum}): ${err.message}`);
    }
    process.exitCode = 1;
  }
}

main();
