import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNERSHIP_TYPE_OPTIONS,
  AGREEMENT_STATUS_OPTIONS,
  DEVICE_CUSTODY_OPTIONS,
} from './device.constants.js';
import {
  ASSET_MASTER_HEADERS,
  ASSET_SAMPLE_ROWS,
  ASSET_REGISTER_PRODUCT_TYPES,
  assetAllowedValueRows,
} from './device.excel.js';

const COL = {
  productType: ASSET_MASTER_HEADERS.indexOf('Asset Type (Product Type)'),
  ownership: ASSET_MASTER_HEADERS.indexOf('Ownership Type'),
  status: ASSET_MASTER_HEADERS.indexOf('Asset Status'),
  custody: ASSET_MASTER_HEADERS.indexOf('Asset Custody'),
};

test('sample rows use only allowed picklist values', () => {
  for (const row of ASSET_SAMPLE_ROWS) {
    assert.ok(
      ASSET_REGISTER_PRODUCT_TYPES.includes(row[COL.productType]),
      `product type ${row[COL.productType]}`
    );
    assert.ok(
      OWNERSHIP_TYPE_OPTIONS.includes(row[COL.ownership]),
      `ownership ${row[COL.ownership]}`
    );
    assert.ok(
      AGREEMENT_STATUS_OPTIONS.includes(row[COL.status]),
      `status ${row[COL.status]}`
    );
    assert.ok(
      DEVICE_CUSTODY_OPTIONS.includes(row[COL.custody]),
      `custody ${row[COL.custody]}`
    );
  }
});

test('sample covers every ownership, status, custody, and product type option', () => {
  const productTypes = new Set(ASSET_SAMPLE_ROWS.map((r) => r[COL.productType]));
  const ownerships = new Set(ASSET_SAMPLE_ROWS.map((r) => r[COL.ownership]));
  const statuses = new Set(ASSET_SAMPLE_ROWS.map((r) => r[COL.status]));
  const custodies = new Set(ASSET_SAMPLE_ROWS.map((r) => r[COL.custody]));

  for (const v of ASSET_REGISTER_PRODUCT_TYPES) assert.ok(productTypes.has(v), v);
  for (const v of OWNERSHIP_TYPE_OPTIONS) assert.ok(ownerships.has(v), v);
  for (const v of AGREEMENT_STATUS_OPTIONS) assert.ok(statuses.has(v), v);
  for (const v of DEVICE_CUSTODY_OPTIONS) assert.ok(custodies.has(v), v);
});

test('allowed values sheet lists every form option exactly once', () => {
  const byField = Object.fromEntries(
    ['Asset Type (Product Type)', 'Ownership Type', 'Asset Status', 'Asset Custody'].map((f) => [
      f,
      [],
    ])
  );
  for (const [field, value] of assetAllowedValueRows()) {
    if (byField[field]) byField[field].push(value);
  }
  assert.deepEqual(byField['Asset Type (Product Type)'], ASSET_REGISTER_PRODUCT_TYPES);
  assert.deepEqual(byField['Ownership Type'], [...OWNERSHIP_TYPE_OPTIONS]);
  assert.deepEqual(byField['Asset Status'], [...AGREEMENT_STATUS_OPTIONS]);
  assert.deepEqual(byField['Asset Custody'], [...DEVICE_CUSTODY_OPTIONS]);
});
