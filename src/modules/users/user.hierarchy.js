import { AppError } from '../../utils/helpers.js';
import { User } from './user.model.js';

function managerIdOf(user = {}) {
  const raw = user.reportingManagerId;
  if (!raw) return null;
  return String(raw?._id || raw);
}

export async function assertReportingManager({ userId, reportingManagerId }) {
  const nextId =
    reportingManagerId == null || reportingManagerId === ''
      ? null
      : String(reportingManagerId).trim();

  if (!nextId) return null;

  if (userId && nextId === String(userId)) {
    throw new AppError('A user cannot be their own reporting manager', 400, 'VALIDATION_ERROR');
  }

  const manager = await User.findOne({ _id: nextId, isDeleted: false, isActive: true });
  if (!manager) {
    throw new AppError('Reporting manager not found or inactive', 400, 'VALIDATION_ERROR');
  }

  if (userId) {
    let cursor = nextId;
    const seen = new Set([String(userId)]);
    for (let depth = 0; depth < 64; depth += 1) {
      if (seen.has(cursor)) {
        throw new AppError('Reporting manager would create a circular chain', 400, 'VALIDATION_ERROR');
      }
      seen.add(cursor);
      const row = await User.findOne({ _id: cursor, isDeleted: false });
      if (!row) break;
      const parentId = managerIdOf(row);
      if (!parentId) break;
      cursor = parentId;
    }
  }

  return nextId;
}

export async function clearReportingManagerForUser(userId) {
  const reports = await User.find({ isDeleted: false, reportingManagerId: String(userId) });
  for (const report of reports) {
    report.reportingManagerId = null;
    await report.save();
  }
}

export function buildHierarchyTree(people = []) {
  const nodes = people.map((person) => ({
    id: String(person.id || person._id),
    fullName: person.fullName || '',
    email: person.email || '',
    designation: person.designation || '',
    reportingManagerId: person.reportingManagerId
      ? String(person.reportingManagerId)
      : person.reportingManager?.id
        ? String(person.reportingManager.id)
        : null,
    isActive: person.isActive !== false,
    directReports: [],
  }));

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];

  for (const node of nodes) {
    const parent = node.reportingManagerId ? byId.get(node.reportingManagerId) : null;
    if (parent && parent.id !== node.id) {
      parent.directReports.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortBranch = (branch) => {
    branch.sort((a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email));
    branch.forEach((child) => sortBranch(child.directReports));
  };
  sortBranch(roots);

  return roots;
}
