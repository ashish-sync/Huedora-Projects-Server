import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const User = defineCollection('users', {
  ...softDelete,
  isActive: true,
  failedLoginAttempts: 0,
  lockUntil: null,
  tokenVersion: 0,
  roleIds: [],
  grantedPermissions: [],
  designation: '',
  systemRole: '',
  reportingManagerId: null,
  /** Relative upload path, e.g. `/uploads/avatars/….jpg` — signed in publicUser. */
  avatarUrl: '',
});
