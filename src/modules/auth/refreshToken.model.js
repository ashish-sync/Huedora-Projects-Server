import { defineCollection } from '../../store/filedb.js';

export const RefreshToken = defineCollection('refresh_tokens', {
  revokedAt: null,
});
