/** Normalize Division/Therapy (campaignType) for exact comparison — trim + lowercase only. */
export function normalizeCampaignTypeExact(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * True when camp.campaignType equals targetType after trim + case fold.
 * Does not use regex — "MOM Camp", "MOM - Special", "DIALYSIS", etc. never match "MOM".
 */
export function campMatchesCampaignTypeExact(camp, targetType) {
  const target = normalizeCampaignTypeExact(targetType);
  if (!target) return false;
  return normalizeCampaignTypeExact(camp?.campaignType) === target;
}

export function filterCampsByCampaignTypeExact(camps, targetType) {
  return (Array.isArray(camps) ? camps : []).filter((camp) => campMatchesCampaignTypeExact(camp, targetType));
}
