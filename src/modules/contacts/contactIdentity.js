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

export async function listActiveContacts(limit = 20000) {
  return Contact.find({ isDeleted: false }).limit(limit);
}

/**
 * Find an existing contact by email or normalized phone.
 */
export async function findContactByIdentity({ email, phone, excludeId } = {}) {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);
  if (!emailKey && !phoneKey) return null;

  const contacts = await listActiveContacts();
  for (const c of contacts) {
    if (excludeId && String(c._id) === String(excludeId)) continue;
    if (emailKey && normalizeEmail(c.email) === emailKey) return c;
    if (
      phoneKey &&
      (phonesEqual(c.contact, phoneKey) ||
        phonesEqual(c.mobile, phoneKey) ||
        phonesEqual(c.contact, phone) ||
        phonesEqual(c.mobile, phone))
    ) {
      return c;
    }
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
  const contacts = await listActiveContacts();
  throwIfContactClash(contacts, { email, phone, excludeId });
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
 * - Matching email or phone → reuse existing
 * - Email matches A and phone matches B → conflict
 */
export async function resolveOrCreateContact(payload, actorId) {
  const email = normalizeEmail(payload.email);
  const phone = normalizePhone(payload.contact || payload.mobile || payload.phone);
  const displayPhone = String(payload.contact || payload.mobile || payload.phone || '').trim();

  if (!payload.name) throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
  if (!email && !displayPhone) {
    throw new AppError('Email or Contact is required for delivery', 400, 'VALIDATION_ERROR');
  }
  if (email) assertValidEmail(email, 'Email');
  if (displayPhone) assertValidPhone(displayPhone, 'Mobile number');

  const contacts = await listActiveContacts();
  let byEmail = null;
  let byPhone = null;
  for (const c of contacts) {
    if (email && normalizeEmail(c.email) === email) byEmail = c;
    if (
      phone &&
      (phonesEqual(c.contact, phone) ||
        phonesEqual(c.mobile, phone) ||
        phonesEqual(c.contact, displayPhone) ||
        phonesEqual(c.mobile, displayPhone))
    ) {
      byPhone = c;
    }
  }

  if (byEmail && byPhone && String(byEmail._id) !== String(byPhone._id)) {
    throw new AppError(
      'Email and phone belong to different contacts. Use matching details or update the existing contact.',
      409,
      'IDENTITY_CONFLICT'
    );
  }

  const existing = byEmail || byPhone;
  if (existing) return { contact: existing, created: false, reused: true };

  const contact = await Contact.create({
    ...payload,
    email,
    contact: displayPhone,
    mobile: displayPhone,
    createdBy: actorId,
    updatedBy: actorId,
  });
  return { contact, created: true, reused: false };
}
