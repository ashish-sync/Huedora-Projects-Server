import XLSX from 'xlsx';
import { CAMP_NAME_OPTIONS } from '../config/campNames.js';
import { CAMP_IMPORT_FIELDS } from './importMapper.js';
import { CONTACT_PERSON_LEVELS } from '../../campOps.constants.js';

const SAMPLE_CLIENTS = [
  'Sun Pharma',
  'Intas',
  'Dr Reddy',
  'Zydus Pharma',
  'Cipla',
];

const SAMPLE_DIVISIONS = [
  'Classic BMD Camps',
  'Viva BMD Camps',
  'BMD Camps',
  'Ortreso',
  'Cachet India BMD Camps',
];

const SAMPLE_SOURCES = ['Import', 'Email', 'WhatsApp', 'Dashboard', 'Manual Paste'];

const SAMPLE_SPECIALTIES = [
  'General Practitioner',
  'Orthopedics',
  'Cardiology',
  'Neurology',
  'Diabetology',
];

const SAMPLE_CITIES = [
  { city: 'Mumbai', pincode: '400001' },
  { city: 'Ahmedabad', pincode: '380001' },
  { city: 'Bengaluru', pincode: '560001' },
  { city: 'New Delhi', pincode: '110001' },
  { city: 'Chennai', pincode: '600001' },
];

const SAMPLE_DURATIONS = [3, 4, 5, 6, 8];

export const SAMPLE_ROW_COUNT = 15;

function formatCampDate(dayOffset) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function computeEndTime(startTime, durationHours) {
  const [hours, minutes] = String(startTime).split(':').map(Number);
  const totalMinutes = hours * 60 + (minutes || 0) + durationHours * 60;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

function buildSampleRow(index) {
  const location = SAMPLE_CITIES[index % SAMPLE_CITIES.length];
  const durationHours = SAMPLE_DURATIONS[index % SAMPLE_DURATIONS.length];
  const startTime = index % 2 === 0 ? '09:00' : '10:30';
  const endTime = computeEndTime(startTime, durationHours);

  return {
    'Source of Request': SAMPLE_SOURCES[index % SAMPLE_SOURCES.length],
    'Client Name': SAMPLE_CLIENTS[index % SAMPLE_CLIENTS.length],
    'Division / Therapy': SAMPLE_DIVISIONS[index % SAMPLE_DIVISIONS.length],
    Method: CAMP_NAME_OPTIONS[index % CAMP_NAME_OPTIONS.length],
    'Camp Date': formatCampDate(index + 3),
    'Request Date': formatCampDate(index + 1),
    'Camp Start Time': startTime,
    'Camp End Time': endTime,
    'Doctor Name': `Dr. Sample ${index + 1}`,
    'Doctor Code': `DOC${101 + index}`,
    'Doctor Type / Specialty': SAMPLE_SPECIALTIES[index % SAMPLE_SPECIALTIES.length],
    'Camp / Clinic Address': `${10 + index} Main Road, ${location.city}`,
    'PIN Code': location.pincode,
    City: location.city,
    'Expected Patients': 40 + index * 3,
    'Contact Person Level': CONTACT_PERSON_LEVELS[index % CONTACT_PERSON_LEVELS.length],
    'Contact Person Name': `Field Rep ${index + 1}`,
    'Contact Person Number': `98765${String(43210 + index).slice(-5)}`,
  };
}

export function getSampleRows(count = SAMPLE_ROW_COUNT) {
  return Array.from({ length: count }, (_, index) => buildSampleRow(index));
}

export function getStandardMapping() {
  return Object.fromEntries(CAMP_IMPORT_FIELDS.map((field) => [field.key, field.label]));
}

export function getMissingStandardHeaders(headers = []) {
  const headerSet = new Set(headers.map((header) => String(header).trim()));
  return CAMP_IMPORT_FIELDS
    .filter((field) => field.required)
    .filter((field) => !headerSet.has(field.label))
    .map((field) => field.label);
}

export function buildSampleWorkbookBuffer(rowCount = SAMPLE_ROW_COUNT) {
  const headers = CAMP_IMPORT_FIELDS.map((field) => field.label);
  const rows = getSampleRows(rowCount);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Camp Import');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
