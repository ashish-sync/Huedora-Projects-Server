/**
 * Named access bundles for TYLO Care team onboarding.
 * Keys are used in CSV column `accessProfile`.
 * Each profile maps to one or more standard roles (Admin, Viewer, Requester, Editor, Approver).
 */
export const TEAM_ACCESS_PROFILES = {
  full_access: {
    roleNames: ['Editor', 'Approver'],
    description: 'All modules — view, edit, and approve',
  },
  camp_coordinator: {
    roleNames: ['Editor'],
    description: 'View all modules; edit Camp One, Document One, and Request One',
  },
  logistics_associate: {
    roleNames: ['Editor', 'Approver'],
    description: 'View all modules; edit and approve Movement One',
  },
};

export function inferAccessProfile(row) {
  const explicit = String(
    row.accessprofile || row.accessProfile || row.profile || ''
  )
    .trim()
    .toLowerCase();
  if (explicit && TEAM_ACCESS_PROFILES[explicit]) return explicit;

  const edit = String(row.edit || '').toLowerCase();
  const approve = String(row.approve || '').toLowerCase();

  if (edit.includes('movement one') && approve.includes('movement one')) {
    return 'logistics_associate';
  }
  if (
    edit.includes('camp one')
    && edit.includes('document one')
    && edit.includes('request one')
  ) {
    return 'camp_coordinator';
  }
  if (edit.includes('all modules') && approve.includes('all modules')) {
    return 'full_access';
  }
  return '';
}
