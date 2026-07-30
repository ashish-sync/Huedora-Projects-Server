import test from 'node:test';
import assert from 'node:assert/strict';

test('parseAssignedUserEmails normalizes coordinator login emails', async () => {
  const { parseAssignedUserEmails } = await import('./campOps.clientAccess.js');
  assert.deepEqual(
    parseAssignedUserEmails('Alice@Example.com; bob@test.com\nalice@example.com'),
    ['alice@example.com', 'bob@test.com'],
  );
});

test('resolveCoordinatorStakeholders returns coordinators and reporting managers', async (t) => {
  const { CampOpsClientMaster } = await import('./campOps.model.js');
  const { User } = await import('../users/user.model.js');
  const { resolveCoordinatorStakeholders } = await import('./campOps.coordinatorNotify.js');

  const suffix = Date.now();
  const managerEmail = `manager-${suffix}@test.com`;
  const coordinatorEmail = `coordinator-${suffix}@test.com`;
  const manager = await User.create({
    fullName: 'Reporting Manager',
    email: managerEmail,
    isActive: true,
  });
  const coordinator = await User.create({
    fullName: 'Coordinator User',
    email: coordinatorEmail,
    isActive: true,
    reportingManagerId: manager._id,
  });
  const clientId = `client-${suffix}`;
  const master = await CampOpsClientMaster.create({
    clientId,
    clientName: 'Demo Client',
    assignedUserEmails: [coordinator.email],
  });

  t.after(async () => {
    for (const user of [manager, coordinator]) {
      user.isDeleted = true;
      user.deletedAt = new Date().toISOString();
      user.isActive = false;
      await user.save();
    }
    master.isDeleted = true;
    master.deletedAt = new Date().toISOString();
    await master.save();
  });

  const result = await resolveCoordinatorStakeholders(clientId);
  assert.equal(result.coordinators.length, 1);
  assert.equal(result.coordinators[0].email, coordinator.email);
  assert.equal(result.managers.length, 1);
  assert.equal(result.managers[0].email, manager.email);
});
