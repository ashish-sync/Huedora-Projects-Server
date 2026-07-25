import { GeoState, GeoZone } from './geo.model.js';
import { CAMP_ZONE_DEFINITIONS } from './geo.zones.constants.js';
import { canonicalStateName } from './geo.zones.js';

/**
 * Seed camp zone master rows and link each state to its zone.
 * Runs after geo states are loaded; idempotent on zone count.
 */
export async function ensureGeoZoneSeed() {
  const existing = await GeoZone.countDocuments({ isDeleted: false });
  if (existing > 0) return { seeded: false, zones: existing };

  const states = await GeoState.find({ isDeleted: false, isActive: true });
  const stateByName = new Map(
    states.map((s) => [canonicalStateName(s.name).toLowerCase(), s])
  );

  const now = new Date().toISOString();
  const rows = CAMP_ZONE_DEFINITIONS.map((def) => {
    const linkedStates = [];
    for (const stateName of def.states) {
      const st = stateByName.get(canonicalStateName(stateName).toLowerCase());
      if (st) {
        linkedStates.push({ stateId: st._id, stateName: st.name });
      } else {
        console.warn(`[geo] Zone seed: state not found in geo master: ${stateName}`);
      }
    }
    return {
      _id: `zone_${def.code}`,
      code: def.code,
      name: def.name,
      sortOrder: def.sortOrder,
      states: linkedStates,
      isActive: true,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
  });

  GeoZone._write(rows);
  console.log(`[geo] Seeded ${rows.length} camp zones`);
  return { seeded: true, zones: rows.length };
}
