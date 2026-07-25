import { writeAudit } from '../../../utils/audit.js';

export async function logAudit({ user, ip, entityType, entityId, action, afterValue }) {
  const actorId = user?._id || user?.id;
  const actorEmail = user?.email || '';
  if (!actorId) return;

  await writeAudit({
    actorId,
    actorEmail,
    action: String(action || 'ingest').toUpperCase().replace(/\./g, '_'),
    entityType: entityType || 'CampOpsCamp',
    entityId: entityId || '',
    after: afterValue || null,
    ip: ip || '',
  });
}
