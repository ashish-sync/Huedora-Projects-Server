import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rewriteServiceAgreementLineTableXml,
  remapLineRowsToLiveTables,
  normalizeDetectedLineColumns,
  canonicalLineColumnLabel,
} from './serviceAgreementLineTable.js';

const legacyTable = `<w:tbl>
<w:tr><w:tc><w:t>Asset Name</w:t></w:tc><w:tc><w:t>Model</w:t></w:tc><w:tc><w:t>Serial Number</w:t></w:tc><w:tc><w:t>Issue Date</w:t></w:tc><w:tc><w:t>Remarks</w:t></w:tc></w:tr>
<w:tr><w:tc><w:t>[Asset Name]</w:t></w:tc><w:tc><w:t>[Model]</w:t></w:tc><w:tc><w:t>[Serial No.]</w:t></w:tc><w:tc><w:t>[Issue Date]</w:t></w:tc><w:tc><w:t>[Remarks]</w:t></w:tc></w:tr>
</w:tbl>`;

const intermediateTable = `<w:tbl>
<w:tr><w:tc><w:t>Display Name</w:t></w:tc><w:tc><w:t>Serial Number</w:t></w:tc><w:tc><w:t>Per Camp Amt</w:t></w:tc><w:tc><w:t>Round Trip covered</w:t></w:tc><w:tc><w:t>Remarks</w:t></w:tc></w:tr>
<w:tr><w:tc><w:t>[Display Name]</w:t></w:tc><w:tc><w:t>[Serial Number]</w:t></w:tc><w:tc><w:t>[Per Camp Amt]</w:t></w:tc><w:tc><w:t>[Round Trip covered]</w:t></w:tc><w:tc><w:t>[Remarks]</w:t></w:tc></w:tr>
</w:tbl>`;

test('rewrites legacy Service Agreement line-item headers and tokens', () => {
  const xml = `<w:document>${legacyTable}</w:document>`;
  const next = rewriteServiceAgreementLineTableXml(xml);
  assert.match(next, /Device Name/);
  assert.match(next, /\[Device Name\]/);
  assert.match(next, /\[Serial Number\]/);
  assert.match(next, /Per Camp \(INR\)/);
  assert.match(next, /\[Per Camp \(INR\)\]/);
  assert.match(next, /Distance Covered \(Km\)/);
  assert.match(next, /\[Distance Covered \(Km\)\]/);
  assert.match(next, /Additional Remarks/);
  assert.match(next, /\[Additional Remarks\]/);
  assert.doesNotMatch(next, /Additional Additional/);
  assert.doesNotMatch(next, /\[Asset Name\]/);
  assert.doesNotMatch(next, /\[Issue Date\]/);
  assert.equal(rewriteServiceAgreementLineTableXml(next), next);
});

test('rewrites intermediate column labels to canonical names', () => {
  const xml = `<w:document>${intermediateTable}</w:document>`;
  const next = rewriteServiceAgreementLineTableXml(xml);
  assert.match(next, /Device Name/);
  assert.match(next, /\[Device Name\]/);
  assert.match(next, /Serial Number/);
  assert.match(next, /Per Camp \(INR\)/);
  assert.match(next, /Distance Covered \(Km\)/);
  assert.match(next, /Additional Remarks/);
  assert.doesNotMatch(next, /Display Name/);
  assert.doesNotMatch(next, /Per Camp Amt/);
  assert.doesNotMatch(next, /Round Trip covered/);
});

test('canonicalLineColumnLabel maps old header names', () => {
  assert.equal(canonicalLineColumnLabel('Display Name'), 'Device Name');
  assert.equal(canonicalLineColumnLabel('Per Camp Amt'), 'Per Camp (INR)');
  assert.equal(canonicalLineColumnLabel('Round Trip covered'), 'Distance Covered (Km)');
  assert.equal(canonicalLineColumnLabel('Remarks'), 'Additional Remarks');
});

test('normalizes doubled Additional Additional Remarks labels', () => {
  const [col] = normalizeDetectedLineColumns([
    {
      key: 'additional_additional_remarks',
      label: 'Additional Additional Remarks',
      inner: 'Additional Additional Remarks',
      token: '[Additional Additional Remarks]',
    },
  ]);
  assert.equal(col.label, 'Additional Remarks');
  assert.equal(col.inner, 'Additional Remarks');
  assert.equal(col.key, 'additional_remarks');
  assert.equal(col.token, '[Additional Remarks]');
});

test('does not rewrite the compensation matrix table', () => {
  const other = `<w:tbl><w:tr><w:tc><w:t>Activity</w:t></w:tc></w:tr><w:tr><w:tc><w:t>₹[Camp Amount]</w:t></w:tc></w:tr></w:tbl>`;
  assert.equal(rewriteServiceAgreementLineTableXml(other), other);
});

test('remaps legacy line-row keys onto the new columns', () => {
  const stored = [
    {
      id: 'table_2',
      tableIndex: 1,
      columns: [{ key: 'asset_name' }, { key: 'model' }, { key: 'serial_no' }],
    },
  ];
  const live = [
    {
      id: 'table_2',
      tableIndex: 1,
      columns: [
        { key: 'device_name', label: 'Device Name' },
        { key: 'serial_number', label: 'Serial Number' },
        { key: 'per_camp_inr', label: 'Per Camp (INR)' },
      ],
    },
  ];
  const next = remapLineRowsToLiveTables(
    { table_2: [{ asset_name: 'BP Monitor', display_name: 'BP Monitor', serial_no: 'SN-1' }] },
    stored,
    live
  );
  assert.equal(next.table_2[0].device_name, 'BP Monitor');
  assert.equal(next.table_2[0].serial_number, 'SN-1');
});
