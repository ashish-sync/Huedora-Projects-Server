/**
 * Camp Request Parser service — orchestrates TS parser, PIN validation, audit.
 */

import { GeoPinCode } from '../geo/geo.model.js';
import { enrichPinRecord } from '../geo/pinCode.service.js';
import { resolveZoneNameForState } from '../geo/geo.zones.js';
import { CampOpsParserAudit } from './campOps.model.js';
import { parseCampRequest, listClientParserConfigs, validateCityPincodeMatch } from './parsers/dist/index.js';
import { trimStr, formatCampTextPayload } from './campOps.helpers.js';
import { AppError } from '../../utils/helpers.js';

/**
 * Map snake_case parser output → camelCase camp import row.
 * Ready for duplicate detection: client + doctor + division/therapy + date + start time.
 */
export function parsedFieldsToCampRow(parsedFields = {}, defaults = {}, pinMaster = null) {
  const city = trimStr(parsedFields.city) || trimStr(pinMaster?.cityName);
  const state = trimStr(parsedFields.state) || trimStr(pinMaster?.stateName);
  const district = trimStr(parsedFields.district) || trimStr(pinMaster?.districtName) || city;
  const zone = trimStr(parsedFields.zone)
    || trimStr(pinMaster?.zone)
    || (state ? (resolveZoneNameForState(state) || '') : '');
  return formatCampTextPayload({
    clientName: trimStr(defaults.clientName),
    campaignType: trimStr(defaults.campaignType) || 'Screening',
    campaignName: trimStr(defaults.campaignName) || 'BMD',
    campDate: trimStr(parsedFields.camp_date),
    startTime: trimStr(parsedFields.camp_start_time) || '09:00',
    endTime: trimStr(parsedFields.camp_end_time),
    doctorName: trimStr(parsedFields.doctor_name),
    doctorCode: trimStr(parsedFields.doctor_code),
    city,
    district,
    state,
    pincode: trimStr(parsedFields.pincode) || trimStr(pinMaster?.pinCode),
    hq: trimStr(parsedFields.hq) || city || district,
    zone,
    campAddress: trimStr(parsedFields.camp_address) || trimStr(parsedFields.address),
    expectedPatients: Math.max(0, Number(parsedFields.expected_patients) || 0),
    fieldPersonName: trimStr(parsedFields.contact_person_name),
    fieldPersonPhone: trimStr(parsedFields.contact_person_number),
    remarks: '',
    source: 'parser',
  });
}

async function lookupPinMaster(pincode) {
  const pin = String(pincode || '').replace(/\D/g, '').slice(0, 6);
  if (pin.length !== 6) return null;

  const matches = await GeoPinCode.find({
    pinCode: pin,
    isDeleted: false,
    isActive: true,
  });

  if (!matches.length) return null;

  const enriched = await enrichPinRecord(matches[0]);
  return {
    pinCode: pin,
    cityName: trimStr(enriched.cityName),
    stateName: trimStr(enriched.stateName),
    districtName: trimStr(enriched.districtName),
    zone: enriched.zone || resolveZoneNameForState(enriched.stateName) || '',
  };
}

/**
 * Parse camp request text with PIN master validation and audit trail.
 * Never modifies original message.
 */
export async function parseCampRequestWithValidation(
  {
    text = '',
    clientId = '',
    clientName = '',
    storeAudit = true,
  } = {},
  actor = {},
) {
  const originalMessage = String(text ?? '');
  if (!originalMessage.trim()) {
    throw new AppError('Message text is required', 400, 'VALIDATION_ERROR');
  }

  const baseResult = parseCampRequest({
    text: originalMessage,
    clientId,
    clientName,
  });

  const pin = baseResult.parsed_fields.pincode;
  const pinMaster = await lookupPinMaster(pin);

  const enrichedFields = { ...baseResult.parsed_fields };
  const enrichmentWarnings = [];

  if (pinMaster) {
    if (!enrichedFields.city && pinMaster.cityName) {
      enrichedFields.city = pinMaster.cityName;
      enrichmentWarnings.push(`City auto-filled from PIN master: ${pinMaster.cityName}`);
    }
    if (!enrichedFields.hq && (pinMaster.cityName || pinMaster.districtName)) {
      enrichedFields.hq = pinMaster.districtName || pinMaster.cityName;
      enrichmentWarnings.push(`HQ auto-filled from PIN master: ${enrichedFields.hq}`);
    }
    if (!enrichedFields.state && pinMaster.stateName) {
      enrichedFields.state = pinMaster.stateName;
    }
    if (!enrichedFields.district && (pinMaster.districtName || pinMaster.cityName)) {
      enrichedFields.district = pinMaster.districtName || pinMaster.cityName;
    }
    if (!enrichedFields.zone && pinMaster.zone) {
      enrichedFields.zone = pinMaster.zone;
    }
  }

  const validation = {
    ...baseResult.validation,
    city_pincode_match: validateCityPincodeMatch(
      enrichedFields.city,
      enrichedFields.pincode,
      pinMaster
        ? { pinCode: pinMaster.pinCode, cityName: pinMaster.cityName, stateName: pinMaster.stateName }
        : null,
    ),
    warnings: [...baseResult.validation.warnings, ...enrichmentWarnings],
  };

  if (pinMaster && !enrichedFields.city) {
    validation.warnings.push(
      `PIN ${pin} maps to city "${pinMaster.cityName || ''}" in master — City field is empty`,
    );
  }

  if (enrichedFields.contact_person_number && enrichedFields.contact_person_number.length !== 10) {
    validation.warnings.push('Contact number is not a valid 10-digit mobile');
  }

  const result = {
    ...baseResult,
    parsed_fields: enrichedFields,
    validation,
    pin_master: pinMaster
      ? {
          city: pinMaster.cityName,
          state: pinMaster.stateName,
          zone: pinMaster.zone,
        }
      : null,
  };

  if (storeAudit) {
    await CampOpsParserAudit.create({
      originalMessage,
      parsed: result,
      clientId: trimStr(clientId),
      clientName: result.parser.client,
      parserUsed: result.parser.parser_used,
      timestamp: new Date().toISOString(),
      actorId: actor?.id || null,
      actorEmail: actor?.email || '',
    });
  }

  return result;
}

export { parseCampRequest, listClientParserConfigs } from './parsers/dist/index.js';
