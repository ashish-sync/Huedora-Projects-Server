import { defineCollection } from '../../store/filedb.js';

export const AssetEvent = defineCollection('asset_events', {
  actorType: 'USER',
  at: undefined,
});
