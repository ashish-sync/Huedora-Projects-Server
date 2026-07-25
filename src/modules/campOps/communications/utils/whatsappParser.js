export {
  parseWhatsAppMessage,
  parseCampMessages,
  parseCampMessageBlock,
  validateWhatsAppCampData,
  PENDING_IMPORT_CLIENT_NAME,
} from './campMessageParser.js';

export const WHATSAPP_HELP_TEXT = `Send camp details in this format (one field per line):

Client: Sun Pharma
Camp Type: BMD
Doctor Name: Dr Sharma
Camp City: Mumbai
Camp State: Maharashtra
Date of the Camp: 20/06/2026
Start Time: 09:00
Expected Patients: 50
Field Person Name: Rahul Mehta

Required: Date and doctor/camp details
Date format: dd/mm/yyyy`;

export const WHATSAPP_FORMAT_EXAMPLE = `Client: Sun Pharma
Camp Type: BMD
Doctor Name: Dr Sharma
Full Clinic Address: City Hospital, Main Road
Camp City: Mumbai
Camp State: Maharashtra
Date of the Camp: 20/06/2026
Start Time: 09:00
End Time: 12:00
Expected Patients: 50
Field Person Name: Rahul Mehta`;
