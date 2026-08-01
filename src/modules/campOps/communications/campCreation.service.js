import { CampOpsCamp as Camp } from './models.js';
import { trimStr } from '../campOps.helpers.js';
import { normalizeCampName } from '../campOps.constants.js';
import {
  generateCampId,
  resolveCampSchedule,
  captureSubmissionTracking,
} from '../campOps.helpers.js';
import { assertHistoricalCampDatesAllowed } from '../campDatePolicy.js';
import { CampDuplicateError, findExistingDuplicateCamp } from './utils/campDuplicateHelpers.js';

export { CampDuplicateError, findExistingDuplicateCamp };

export async function createCampFromRow({
  row,
  client,
  createdBy,
  source = 'api',
  submittedAt,
  extras = {},
  permissions = null,
}) {
  const duplicate = await findExistingDuplicateCamp({ client, row });
  if (duplicate) {
    throw new CampDuplicateError(duplicate);
  }

  assertHistoricalCampDatesAllowed(createdBy, permissions, {
    campDate: row.campDate,
    requestDate: row.requestDate,
  });

  const campId = await generateCampId(row.campDate);
  const schedule = resolveCampSchedule({
    startTime: row.startTime || '09:00',
    endTime: row.endTime,
    durationHours: row.durationHours,
  });
  const tracking = captureSubmissionTracking(submittedAt || new Date());
  const actorId = createdBy?._id || createdBy?.id || null;
  const actorEmail = createdBy?.email || '';

  const payload = {
    campId,
    clientId: client._id,
    clientName: client.name,
    campaignName: normalizeCampName(row.campaignName),
    campaignType: trimStr(row.campaignType) || 'Screening',
    doctorName: trimStr(row.doctorName),
    doctorCode: trimStr(row.doctorCode),
    scCode: trimStr(row.scCode),
    mslNo: trimStr(row.mslNo),
    speciality: trimStr(row.speciality),
    hospitalName: trimStr(row.hospitalName),
    clinicName: trimStr(row.clinicName),
    campAddress: trimStr(row.campAddress),
    city: trimStr(row.city),
    state: trimStr(row.state),
    pincode: trimStr(row.pincode),
    campDate: row.campDate,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    durationHours: schedule.durationHours,
    expectedPatients: row.expectedPatients,
    actualPatients: row.actualPatients,
    fieldPersonName: trimStr(row.fieldPersonName),
    fieldPersonPhone: trimStr(row.fieldPersonPhone),
    remarks: trimStr(row.remarks),
    source,
    lifecycleStage: 'request',
    status: 'pending_review',
    createdById: actorId,
    createdByEmail: actorEmail,
    ...tracking,
    ...extras,
  };

  for (const key of ['whatsappMessageId', 'emailIngestId']) {
    if (payload[key] == null || payload[key] === '') {
      delete payload[key];
    }
  }

  return Camp.create(payload);
}
