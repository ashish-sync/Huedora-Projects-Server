import { Contact } from '../../contacts/contact.model.js';
import { trimStr } from '../campOps.helpers.js';
import { normalizePastePhone } from '../import/pasteFieldRegistry.js';

function normalizeNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(name) {
  return new Set(normalizeNameKey(name).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const t of left) if (right.has(t)) inter += 1;
  return inter / (left.size + right.size - inter);
}

/**
 * Exact then safe fuzzy match against Contact Directory.
 * Ambiguous fuzzy matches are returned for REVIEW — never auto-selected.
 */
export async function matchPeopleAgainstContacts(people = []) {
  if (!Array.isArray(people) || !people.length) return [];

  const contacts = await Contact.find({ isDeleted: false }).limit(5000);
  const results = [];

  for (const person of people) {
    const name = trimStr(person.name);
    const phones = (person.mobileNumbers || [])
      .map((p) => normalizePastePhone(p))
      .filter(Boolean);
    if (!name && !phones.length) {
      results.push({ person, status: 'UNMATCHED', matches: [] });
      continue;
    }

    const exact = [];
    for (const contact of contacts) {
      const contactPhone = normalizePastePhone(contact.mobile || contact.contact || contact.phone);
      const nameExact = name && normalizeNameKey(contact.name) === normalizeNameKey(name);
      const phoneExact = phones.length && contactPhone && phones.includes(contactPhone);
      if (nameExact || phoneExact) {
        exact.push({
          contactId: contact._id,
          name: contact.name,
          phone: contactPhone,
          score: 1,
          reason: nameExact && phoneExact ? 'name+phone' : nameExact ? 'name' : 'phone',
        });
      }
    }

    if (exact.length === 1) {
      results.push({
        person,
        status: 'MATCHED',
        match: exact[0],
        matches: exact,
        provenance: 'master_matched',
      });
      continue;
    }
    if (exact.length > 1) {
      results.push({ person, status: 'REVIEW', matches: exact, provenance: 'ambiguous_exact' });
      continue;
    }

    if (!name) {
      results.push({ person, status: 'UNMATCHED', matches: [] });
      continue;
    }

    const fuzzy = [];
    for (const contact of contacts) {
      const score = jaccard(name, contact.name);
      if (score >= 0.85) {
        fuzzy.push({
          contactId: contact._id,
          name: contact.name,
          phone: normalizePastePhone(contact.mobile || contact.contact || contact.phone),
          score,
          reason: 'fuzzy_name',
        });
      }
    }
    fuzzy.sort((a, b) => b.score - a.score);

    if (fuzzy.length === 1 && fuzzy[0].score >= 0.92) {
      results.push({
        person,
        status: 'MATCHED_REVIEW',
        match: fuzzy[0],
        matches: fuzzy,
        provenance: 'fuzzy_matched',
      });
      continue;
    }
    if (fuzzy.length > 1) {
      results.push({ person, status: 'REVIEW', matches: fuzzy.slice(0, 5), provenance: 'ambiguous_fuzzy' });
      continue;
    }

    results.push({ person, status: 'UNMATCHED', matches: [] });
  }

  return results;
}
