import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLineValuesIntoPlaceholders } from './serviceAgreementLineTable.js';

test('fills legacy scalar placeholders from line-item values', () => {
  const placeholders = [
    { key: 'display_name', label: 'Display Name' },
    { key: 'per_camp_amt', label: 'Per Camp Amt' },
    { key: 'round_trip', label: 'Round Trip covered' },
    { key: 'remarks', label: 'Remarks' },
  ];
  const tables = [
    {
      id: 'table_2',
      columns: [
        { key: 'device_name', label: 'Device Name' },
        { key: 'per_camp', label: 'Per Camp (INR)' },
        { key: 'distance', label: 'Distance Covered (Km)' },
        { key: 'remarks', label: 'Additional Remarks' },
      ],
    },
  ];
  const lineRows = {
    table_2: [
      {
        device_name: 'BP Monitor',
        per_camp: '400',
        distance: '50',
        remarks: 'note',
      },
    ],
  };
  const merged = mergeLineValuesIntoPlaceholders({}, placeholders, tables, lineRows);
  assert.equal(merged.display_name, 'BP Monitor');
  assert.equal(merged.per_camp_amt, '400');
  assert.equal(merged.round_trip, '50');
  assert.equal(merged.remarks, 'note');
});
