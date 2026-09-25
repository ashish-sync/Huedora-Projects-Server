import { Contact } from './contact.model.js';
import {
  findIdentityClash,
  normalizeEmail,
  normalizePhone,
  phonesEqual,
  assertValidEmail,
  assertValidPhone,
} from '../../utils/identityNormalize.js';
import { AppError } from '../../utils/helpers.js';
import { assignPreservingExisting } from '../../store/dataIntegrity.js';
import { escapeRegex } from '../../utils/escapeRegex.js';

/**
 * Load active contacts for name-scan / clash checks.
 * Prefer targeted identity lookups (findContactByIdentity) for email/phone.
 * Soft cap keeps memory bounded; callers that need completeness should use
 * indexed queries below instead of this list.
 */
export async function listActiveContacts(limit = 50000) {
  const capped = Math.min(Math.max(Number(limit) || 50000, 1), 100000);
  return Contact.find({ isDeleted: false }).limit(capped);
}

function contactMatchesPhone(contact, phoneKey, displayPhone) {
  if (!phoneKey && !displayPhone) return false;
  return (
    (phoneKey && (
      phonesEqual(contact.contact, phoneKey)
      || phonesEqual(contact.mobile, phoneKey)
    ))
    || (displayPhone && (
      phonesEqual(contact.contact, displayPhone)
      || phonesEqual(contact.mobile, displayPhone)
    ))
  );
}

/**
 * Targeted identity lookup — query by email and/or phone without a full 20k scan.
 * Falls back to a bounded list scan only when normalized phone formats differ in storage.
 */
export async function findContactByIdentity({ email, phone, excludeId } = {}) {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);
  const displayPhone = String(phone || '').trim();
  if (!emailKey && !phoneKey && !displayPhone) return null;

  if (emailKey) {
    const byEmail = await Contact.findOne({ email: emailKey, isDeleted: false });
    if (byEmail && !(excludeId && String(byEmail._id) === String(excludeId))) {
      return byEmail;
    }
    // Legacy rows may store mixed-case email before normalize on write.
    const emailHits = await Contact.find({ isDeleted: false, email: new RegExp(`^${escapeRegex(emailKey)}$`, 'i') }).limit(5);
    for (const hit of emailHits) {
      if (excludeId && String(hit._id) === String(excludeId)) continue;
      if (normalizeEmail(hit.email) === emailKey) return hit;
    }
  }

  if (phoneKey || displayPhone) {
    const candidates = [];
    if (displayPhone) {
      const exact = await Contact.find({
        isDeleted: false,
        $or: [{ contact: displayPhone }, { mobile: displayPhone }],
      }).limit(20);
      candidates.push(...exact);
    }
    if (phoneKey && phoneKey !== displayPhone) {
      const byNorm = await Contact.find({
        isDeleted: false,
        $or: [{ contact: phoneKey }, { mobile: phoneKey }],
      }).limit(20);
      candidates.push(...byNorm);
    }
    for (const c of candidates) {
      if (excludeId && String(c._id) === String(excludeId)) continue;
      if (contactMatchesPhone(c, phoneKey, displayPhone)) return c;
    }

    // Last resort: bounded scan for alternate phone formats (spaces, +91, etc.).
    const contacts = await listActiveContacts(50000);
    for (const c of contacts) {
      if (excludeId && String(c._id) === String(excludeId)) continue;
      if (contactMatchesPhone(c, phoneKey, displayPhone)) return c;
    }
  }

  return null;
}

/**
 * Resolve a Custodian Contact Excel/form value to an existing Contact Directory row.
 * Matches _id, email, mobile/phone, or exact name (case-insensitive).
 * Does not create contacts. The same contact may be linked to many assets.
 */
export async function findContactForCustodian(raw, { requireMatch = false } = {}) {
  const value = String(raw || '').trim();
  if (!value) {
    if (requireMatch) {
      throw new AppError(
        'Custodian Contact is required when Asset Custody is Individual or Service Provider, and must match an existing Contact Directory record.',
        400,
        'VALIDATION_ERROR',
      );
    }
    return null;
  }

  if (/^[a-f0-9]{24}$/i.test(value)) {
    const byId = await Contact.findOne({ _id: value, isDeleted: false });
    if (byId) return byId;
    if (requireMatch) {
      throw new AppError(
        'Custodian Contact must match an existing Contact Directory record.',
        400,
        'VALIDATION_ERROR',
      );
    }
    return null;
  }

  const looksLikeEmail = value.includes('@');
  const byIdentity = await findContactByIdentity({
    email: looksLikeEmail ? value : '',
    phone: looksLikeEmail ? '' : value,
  });
  if (byIdentity) return byIdentity;

  const contacts = await listActiveContacts();
  const needle = value.toLowerCase();
  const nameHits = contacts.filter(
    (contact) => String(contact.name || '').trim().toLowerCase() === needle,
  );
  if (nameHits.length === 1) return nameHits[0];
  if (nameHits.length > 1) {
    throw new AppError(
      `Custodian Contact “${value}” matches multiple Contact Directory records. Use email or mobile number.`,
      400,
      'VALIDATION_ERROR',
    );
  }

  if (requireMatch) {
    throw new AppError(
      'Custodian Contact must match an existing Contact Directory record (name, email, or mobile).',
      400,
      'VALIDATION_ERROR',
    );
  }
  return null;
}

/**
 * Throw if email/phone belongs to another contact.
 * Prefer findContactByIdentity + reuse for create flows that should soft-reuse.
 */
export async function assertContactIdentityAvailable({ email, phone, excludeId } = {}) {
  if (email) assertValidEmail(email, 'Email');
  if (phone) assertValidPhone(phone, 'Mobile number');
  const byIdentity = await findContactByIdentity({ email, phone, excludeId });
  if (byIdentity) {
    throwIfContactClash([byIdentity], { email, phone, excludeId });
  }
}

export function throwIfContactClash(contacts, { email, phone, excludeId } = {}) {
  const clash = findIdentityClash(contacts, {
    email,
    phone,
    excludeId,
    emailFields: ['email'],
    phoneFields: ['contact', 'mobile'],
    label: 'Contact',
  });
  if (clash) throw new AppError(clash.message, 409, clash.code);
}

/**
 * Resolve or create contact by identity.
 * - Matching email or phone → reuse existing and merge non-blank payload fields
 * - Email matches A and phone matches B → conflict
 */
export async function resolveOrCreateContact(payload, actorId, { mergeOnReuse = true } = {}) {
  const email = normalizeEmail(payload.email);
  const phone = normalizePhone(payload.contact || payload.mobile || payload.phone);
  const displayPhone = String(payload.contact || payload.mobile || payload.phone || '').trim();

  if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
  if (!email && !displayPhone) {
    throw new AppError('Email or Contact is required for delivery', 400, 'VALIDATION_ERROR');
  }
  if (email) assertValidEmail(email, 'Email');
  if (displayPhone) assertValidPhone(displayPhone, 'Mobile number');

  const byEmail = email ? await findContactByIdentity({ email }) : null;
  const byPhone = (phone || displayPhone)
    ? await findContactByIdentity({ phone: displayPhone || phone })
    : null;

  if (byEmail && byPhone && String(byEmail._id) !== String(byPhone._id)) {
    throw new AppError(
      'Email and phone belong to different contacts. Use matching details or update the existing contact.',
      409,
      'IDENTITY_CONFLICT'
    );
  }

  const existing = byEmail || byPhone;
  if (existing) {
    if (mergeOnReuse) {
      const mergePayload = { ...payload };
      // Never wipe roster via create/reuse path — omit empty arrays.
      if (Array.isArray(mergePayload.providerEmployees) && mergePayload.providerEmployees.length === 0) {
        delete mergePayload.providerEmployees;
      }
      assignPreservingExisting(existing, {
        ...mergePayload,
        email: email || existing.email,
        contact: displayPhone || existing.contact,
        mobile: displayPhone || existing.mobile,
      });
      existing.updatedBy = actorId;
      await existing.save();
    }
    return { contact: existing, created: false, reused: true, merged: Boolean(mergeOnReuse) };
  }

  const contact = await Contact.create({
    ...payload,
    email,
    contact: displayPhone,
    mobile: displayPhone,
    createdBy: actorId,
    updatedBy: actorId,
  });
  return { contact, created: true, reused: false, merged: false };
}
