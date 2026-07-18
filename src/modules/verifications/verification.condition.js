/**
 * Twice-monthly verification condition rules for Agreement Signed assets.
 */

export function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export function isRoundDone(round) {
  return Boolean(round && round.verifiedOn);
}

export function roundCount(record) {
  if (!record) return 0;
  return (isRoundDone(record.round1) ? 1 : 0) + (isRoundDone(record.round2) ? 1 : 0);
}

export function latestVerifiedAt(asset, record) {
  const times = [
    record?.round1?.verifiedOn,
    record?.round2?.verifiedOn,
    asset?.lastVerifiedAt,
  ]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!times.length) return null;
  return new Date(Math.max(...times));
}

/**
 * SAFE. both monthly rounds done
 * CAUTION. one round done, OR not verified within the last 1 day
 * DANGER. no rounds done and missing for >= days in current month
 */
export function computeDeviceCondition(asset, record, now = new Date()) {
  const done = roundCount(record);
  const last = latestVerifiedAt(asset, record);
  const daysSince = last
    ? Math.floor((now.getTime() - last.getTime()) / 86400000)
    : Number.POSITIVE_INFINITY;
  const dim = daysInMonth(now.getFullYear(), now.getMonth());

  let condition = 'DANGER';
  let reason = 'No verification this month';

  if (done >= 2) {
    condition = 'SAFE';
    reason = 'Both monthly verifications complete';
  } else if (done === 1) {
    condition = 'CAUTION';
    reason = 'One verification complete. Second due this month.';
  } else if (daysSince >= dim) {
    condition = 'DANGER';
    reason = `No verification for ${Number.isFinite(daysSince) ? daysSince : dim}+ days (month has ${dim} days)`;
  } else if (daysSince >= 1 || !last) {
    condition = 'CAUTION';
    reason = last
      ? `Not verified in the last ${daysSince} day${daysSince === 1 ? '' : 's'}`
      : 'Awaiting first verification this month';
  } else {
    condition = 'CAUTION';
    reason = 'Verification pending for this month';
  }

  return {
    condition,
    reason,
    roundsDone: done,
    roundsRequired: 2,
    round1Done: isRoundDone(record?.round1),
    round2Done: isRoundDone(record?.round2),
    nextRound: done >= 2 ? null : done === 1 ? 2 : 1,
    daysSince: Number.isFinite(daysSince) ? daysSince : null,
    daysInMonth: dim,
    lastVerifiedAt: last ? last.toISOString() : null,
  };
}

export function periodKeyFromDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function startOfDay(dateLike) {
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateLike)) {
    const [y, m, d] = dateLike.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(dateLike) {
  if (typeof dateLike === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateLike)) {
    const [y, m, d] = dateLike.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/** True if any verification timestamp falls within [from, to] inclusive. */
export function verifiedInRange(asset, record, from, to) {
  if (!from || !to) return true;
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const stamps = [
    record?.round1?.verifiedOn,
    record?.round2?.verifiedOn,
    asset?.lastVerifiedAt,
  ]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!stamps.length) return false;
  return stamps.some((t) => t >= fromMs && t <= toMs);
}
