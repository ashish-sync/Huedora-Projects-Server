/**
 * Four real-world Manual Paste fixtures from the Camp One event-extractor brief
 * and existing paste regression corpus (labeled / free-form / multi-event / conflict).
 */
export const PASTE_FIXTURE_LABELED = `
Date: 15/08/2026
Camp Type: Screening
Doctor Name: Dr. Rajesh Kumar
Doctor Code: DOC123
Camp Address: 12 MG Road, Pune, Maharashtra 411001
Expected Patients: 45
Technician Name: Ignore Me
Technician Mobile: 9999999999
Client: Some Client
SE Name: Amit Sharma
SE Mobile: 9876543210
ABM Name: Should Not Pick
ABM Mobile: 1111111111
Start Time: 10:00 AM
End Time: 02:30 PM
`.trim();

/** Free-form WhatsApp / OCR-like — Sri Sarada Clinic example from the brief. */
export const PASTE_FIXTURE_FREEFORM_CHENNAI = `
Camp tomorrow
Dr Name: Anita Rao
Sri Sarada Clinic Besent Nagar (Chennai)
Timing 9AM onwards
Pts 30
SE: Karthik 9000012345
`.trim();

/** Multi-event paste with separator — two camps in one input. */
export const PASTE_FIXTURE_MULTI_EVENT = `
Date: 15.08.2026
Doctor: Balkrishna Patil
Clinic: Guru Krupa Clinic, Pune 411004
Time: 09:00 to 12:00
SE Name: Vishal Gupta
SE Mobile: 7559133770
---
Date: 16/08/2026
Day: MONDAY
Doctor Name: Dr. Meera Shah
Camp Venue: City Care Hospital, Ballari
PIN: 583101
08.30 am - 1PM
Expected Patients: 40
Contact: Ramesh 9876501234
`.trim();

/** Conflicting day label + single noon time (must not invent endTime). */
export const PASTE_FIXTURE_CONFLICT_NOON = `
Date: 16/08/2026
Day: MONDAY
Doctor: Suresh Nair
Address: Main Road Clinic, Kochi, Kerala 682001
Time: 12:00pm
BO Name: Priya
BO Contact No: +91 98765 43210
`.trim();

export const PASTE_FIXTURES = {
  labeled: PASTE_FIXTURE_LABELED,
  freeformChennai: PASTE_FIXTURE_FREEFORM_CHENNAI,
  multiEvent: PASTE_FIXTURE_MULTI_EVENT,
  conflictNoon: PASTE_FIXTURE_CONFLICT_NOON,
};
