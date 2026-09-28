import { describe, expect, it } from 'vitest';
import { mergeLineValuesIntoPlaceholders } from './serviceAgreementLineTable.js';

describe('mergeLineValuesIntoPlaceholders', () => {
  it('fills legacy scalar placeholders from line-item values', () => {
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
    expect(merged.display_name).toBe('BP Monitor');
    expect(merged.per_camp_amt).toBe('400');
    expect(merged.round_trip).toBe('50');
    expect(merged.remarks).toBe('note');
  });
});
