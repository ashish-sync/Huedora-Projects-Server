import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExportProgramScope, serializeExportTemplate } from './campOps.export.js';

test('serializeExportTemplate exposes Mongo _id as id for the UI', () => {
  const row = serializeExportTemplate({
    _id: 'tmpl-1',
    name: 'Ops sheet',
    columns: ['campId'],
  });
  assert.equal(row.id, 'tmpl-1');
  assert.equal(row._id, 'tmpl-1');
  assert.equal(row.name, 'Ops sheet');
});

test('applyExportProgramScope keeps only camps for assigned programs', () => {
  const scoped = [{ clientId: 'client-a', programName: 'Ortho', campName: 'BMD' }];
  const rows = [
    { clientId: 'client-a', campaignType: 'Ortho', campaignName: 'BMD' },
    { clientId: 'client-a', campaignType: 'Ortho', campaignName: 'Screening' },
    { clientId: 'client-b', campaignType: 'Ortho', campaignName: 'BMD' },
  ];
  const out = applyExportProgramScope(rows, scoped);
  assert.equal(out.length, 1);
  assert.equal(out[0].campaignName, 'BMD');
  assert.equal(out[0].clientId, 'client-a');
});

test('applyExportProgramScope leaves unrestricted users unfiltered', () => {
  const rows = [
    { clientId: 'client-a', campaignType: 'Ortho', campaignName: 'BMD' },
    { clientId: 'client-b', campaignType: 'Cardio', campaignName: 'ECG' },
  ];
  assert.equal(applyExportProgramScope(rows, null).length, 2);
  assert.equal(applyExportProgramScope(rows, []).length, 0);
});
