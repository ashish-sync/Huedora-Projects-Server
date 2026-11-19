import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectCsvDelimiter,
  parseCsvLine,
  streamCsvFile,
  peekCsvMeta,
  csvDelimiterLabel,
} from './csvStream.js';

test('parseCsvLine splits on comma and respects quotes', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseCsvLine('"a,b",c'), ['a,b', 'c']);
  assert.deepEqual(parseCsvLine('a,"b""c",d'), ['a', 'b"c', 'd']);
});

test('parseCsvLine accepts semicolon and tab delimiters', () => {
  assert.deepEqual(parseCsvLine('a;b;c', ';'), ['a', 'b', 'c']);
  assert.deepEqual(parseCsvLine('a\tb\tc', '\t'), ['a', 'b', 'c']);
  assert.deepEqual(parseCsvLine('"a;b";c', ';'), ['a;b', 'c']);
});

test('detectCsvDelimiter picks comma for standard CSV', () => {
  const text = 'Name,Email,Phone\nAda,ada@x.com,111\n';
  assert.equal(detectCsvDelimiter(text), ',');
});

test('detectCsvDelimiter picks semicolon (EU Excel style)', () => {
  const text = 'Name;Email;Phone\nAda;ada@x.com;111\nBob;bob@x.com;222\n';
  assert.equal(detectCsvDelimiter(text), ';');
});

test('detectCsvDelimiter picks tab for TSV', () => {
  const text = 'Name\tEmail\tPhone\nAda\tada@x.com\t111\n';
  assert.equal(detectCsvDelimiter(text), '\t');
});

test('detectCsvDelimiter does not collapse semicolon rows into one cell', () => {
  const text = 'A;B;C\n1;2;3\n';
  const delim = detectCsvDelimiter(text);
  const cells = parseCsvLine('1;2;3', delim);
  assert.equal(delim, ';');
  assert.equal(cells.length, 3);
  assert.deepEqual(cells, ['1', '2', '3']);
});

test('csvDelimiterLabel maps separators', () => {
  assert.equal(csvDelimiterLabel(','), 'comma');
  assert.equal(csvDelimiterLabel(';'), 'semicolon');
  assert.equal(csvDelimiterLabel('\t'), 'tab');
});

test('streamCsvFile auto-detects semicolon and maps columns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-csv-'));
  const filePath = path.join(dir, 'eu.csv');
  try {
    fs.writeFileSync(
      filePath,
      '\uFEFFFull Name;Email;Mobile\nAda Lovelace;ada@example.com;9876543210\n',
      'utf8',
    );
    const rows = [];
    for await (const row of streamCsvFile(filePath)) {
      rows.push(row);
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delimiter, ';');
    assert.deepEqual(rows[0].headers, ['Full Name', 'Email', 'Mobile']);
    assert.equal(rows[0].record['Full Name'], 'Ada Lovelace');
    assert.equal(rows[0].record.Email, 'ada@example.com');
    assert.equal(rows[0].record.Mobile, '9876543210');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('peekCsvMeta returns delimiter metadata for tab files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tylo-tsv-'));
  const filePath = path.join(dir, 'sample.tsv');
  try {
    fs.writeFileSync(filePath, 'State\tDistrict\tPin\nMH\tPune\t411001\n', 'utf8');
    const meta = await peekCsvMeta(filePath);
    assert.equal(meta.delimiter, '\t');
    assert.equal(meta.delimiterLabel, 'tab');
    assert.deepEqual(meta.headers, ['State', 'District', 'Pin']);
    assert.equal(meta.totalRows, 1);
    assert.equal(meta.sampleRows[0].State, 'MH');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
