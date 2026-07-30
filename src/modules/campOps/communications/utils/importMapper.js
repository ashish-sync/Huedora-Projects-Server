import { normalizeCampName } from '../config/campNames.js';
import { parseLocalDateInput, computeDurationHours, resolveCampSchedule, resolveClinicHospitalName } from './campHelpers.js';
import { CAMP_IMPORT_FIELDS } from '../../campOps.constants.js';
import { matchImportColumns, getImportFieldDefinitions } from '../../import/importColumnMatcher.js';
import { formatCampTextPayload } from '../../campOps.helpers.js';

export { CAMP_IMPORT_FIELDS };
export { matchImportColumns, getImportFieldDefinitions };

export function suggestMappings(headers) {
  return matchImportColumns(headers).mapping;
}

export function mapRows(rows, mapping, defaultClientName = '') {
  return rows.map((row, index) => {
    const mapped = { rowNumber: index + 2 };

    const fieldKeys = Object.keys(mapping || {});
    const keys = fieldKeys.length ? fieldKeys : CAMP_IMPORT_FIELDS.map((field) => field.key);

    keys.forEach((fieldKey) => {
      const sourceHeader = mapping?.[fieldKey];
      mapped[fieldKey] = sourceHeader
        ? String(row[sourceHeader] ?? '').trim()
        : '';
    });

    if (!mapped.clientName && defaultClientName) {
      mapped.clientName = defaultClientName;
    }

    return mapped;
  });
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsed = new Date(excelEpoch.getTime() + value * 86400000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const local = parseLocalDateInput(value);
    if (local) return local;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function validateMappedRows(rows) {
  const validRows = [];
  const invalidRows = [];

  rows.forEach((row) => {
    const errors = [];

    if (!String(row.clientName || '').trim()) errors.push('Client name is required');
    if (!String(row.campDate || '').trim()) errors.push('Camp date is required');

    const campDate = parseDate(row.campDate);
    if (String(row.campDate || '').trim() && !campDate) errors.push('Camp date is invalid');

    const expectedPatients = row.expectedPatients === '' || row.expectedPatients == null
      ? null
      : Number(row.expectedPatients);
    if (expectedPatients != null && Number.isNaN(expectedPatients)) {
      errors.push('Expected patients must be a number');
    }

    const startTime = String(row.startTime || '').trim() || '09:00';
    const endTime = String(row.endTime || '').trim();

    if (endTime && computeDurationHours(startTime, endTime) == null) {
      errors.push('End time is invalid');
    }

    const schedule = resolveCampSchedule({ startTime, endTime });

    const normalized = formatCampTextPayload({
      ...row,
      clientName: String(row.clientName || '').trim(),
      campaignName: normalizeCampName(row.campaignName),
      campaignType: String(row.campaignType || 'Screening').trim(),
      doctorName: String(row.doctorName || '').trim(),
      doctorCode: String(row.doctorCode || '').trim(),
      hospitalName: resolveClinicHospitalName(row.hospitalName, row.clinicName),
      clinicName: '',
      campAddress: String(row.campAddress || '').trim(),
      city: String(row.city || '').trim(),
      state: String(row.state || '').trim(),
      pincode: String(row.pincode || '').trim(),
      campDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      durationHours: schedule.durationHours,
      expectedPatients: expectedPatients ?? 0,
      fieldPersonName: String(row.fieldPersonName || '').trim(),
      fieldPersonPhone: String(row.fieldPersonPhone || '').trim(),
      remarks: String(row.remarks || '').trim(),
    });

    if (errors.length) {
      invalidRows.push({ rowNumber: row.rowNumber, data: normalized, errors });
    } else {
      validRows.push(normalized);
    }
  });

  return { validRows, invalidRows };
}
