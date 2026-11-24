import { writeAudit } from '../../../utils/audit.js';

/**
 * Normalize communication-ingest creates onto the same Activity Log action
 * used by UI / paste / Excel camp creates (`camp_ops.create`).
 */
function resolveIngestAction(action) {
  const raw = String(action || 'ingest').trim();
  if (/^create[_.-]?(email|whatsapp)$/i.test(raw) || /^CREATE[_.-]?(EMAIL|WHATSAPP)$/i.test(raw)) {
    return 'camp_ops.create';
  }
  // Prefer dotted camp_ops.* codes; otherwise keep a stable uppercase code.
  if (raw.startsWith('camp_ops.')) return raw;
  return raw.toUpperCase().replace(/\./g, '_');
}

function resolveIngestEntityType(entityType) {
  const raw = String(entityType || '').trim();
  if (!raw || /^camp$/i.test(raw) || /^CampOpsCamp$/i.test(raw)) return 'camp_ops_camp';
  return raw;
}

function resolveIngestSource(action, ip) {
  const hay = `${action || ''} ${ip || ''}`.toLowerCase();
  if (/email|whatsapp|ingest|automation/.test(hay)) return 'Automation';
  return 'UI';
}

export async function logAudit({ user, ip, entityType, entityId, action, afterValue }) {
  const actorId = user?._id || user?.id || null;
  const actorEmail = user?.email || (actorId ? '' : 'system@ingest');
  const resolvedAction = resolveIngestAction(action);

  await writeAudit({
    actorId,
    actorType: actorId ? 'USER' : 'SYSTEM',
    actorEmail,
    action: resolvedAction,
    entityType: resolveIngestEntityType(entityType),
    entityId: entityId || '',
    after: afterValue || null,
    ip: ip || '',
    source: resolveIngestSource(action, ip),
    programmeId: afterValue?.programName || afterValue?.drugTherapyName || null,
  });
}
