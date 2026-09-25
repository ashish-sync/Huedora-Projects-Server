import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseOverviewPipeline,
  invoiceOverviewPipeline,
  commercialDocOverviewPipeline,
  summarizeCommercialAggregates,
  firstGroupRow,
  trackingInventoryByStatusPipeline,
  trackingEligibleAssetsPipeline,
  formatTrackingInventoryBuckets,
  assetOnboardDateExpression,
  trackingOnboardDateStages,
} from './dashboard.aggregations.js';
import { ASSET_STATUS_OPTIONS } from '../devices/device.constants.js';

test('finance expense pipeline groups totals without hydrating rows', () => {
  const pipeline = expenseOverviewPipeline();
  assert.equal(pipeline[0].$match.isDeleted, false);
  assert.ok(pipeline[1].$group.total);
  assert.ok(pipeline[1].$group.open);
  assert.ok(pipeline[1].$group.count);
});

test('firstGroupRow defaults safely', () => {
  assert.deepEqual(firstGroupRow([]), { total: 0, open: 0, count: 0 });
  assert.deepEqual(firstGroupRow([{ total: 12.5, open: 2, count: 4 }]), {
    total: 12.5,
    open: 2,
    count: 4,
  });
});

test('summarizeCommercialAggregates counts drafts and invoice totals', () => {
  const summary = summarizeCommercialAggregates([
    { _id: { documentType: 'proforma', status: 'Draft' }, count: 3, grandTotal: 0 },
    { _id: { documentType: 'purchase_order', status: 'Uploaded' }, count: 2, grandTotal: 0 },
    { _id: { documentType: 'client_invoice', status: 'Submitted' }, count: 1, grandTotal: 1500 },
    { _id: { documentType: 'client_invoice', status: 'Approved' }, count: 2, grandTotal: 500 },
  ]);
  assert.equal(summary.proformaDraft, 3);
  assert.equal(summary.proformaCount, 3);
  assert.equal(summary.poDraft, 2);
  assert.equal(summary.purchaseOrderCount, 2);
  assert.equal(summary.commercialSubmitted, 1);
  assert.equal(summary.clientInvoiceCount, 3);
  assert.equal(summary.clientInvoiceTotal, 2000);
});

test('commercial pipeline matches dashboard document types', () => {
  const pipeline = commercialDocOverviewPipeline(['proforma', 'purchase_order']);
  assert.deepEqual(pipeline[0].$match.documentType.$in, ['proforma', 'purchase_order']);
});

test('invoice pipeline exists for open/total aggregation', () => {
  const pipeline = invoiceOverviewPipeline();
  assert.ok(pipeline[1].$group.open.$sum.$cond);
});

test('tracking inventory pipeline groups by status without returning docs', () => {
  const from = new Date(2024, 0, 1);
  const to = new Date(2024, 11, 31, 23, 59, 59, 999);
  const pipeline = trackingInventoryByStatusPipeline(from, to);
  assert.equal(pipeline[0].$match.isDeleted, false);
  assert.ok(pipeline[1].$addFields._onboardDate);
  assert.ok(pipeline[2].$match._onboardDate.$gte);
  const group = pipeline.find((s) => s.$group);
  assert.equal(group.$group._id, '$_status');
  assert.ok(group.$group.qty);
  assert.ok(group.$group.value);
  assert.ok(!pipeline.some((s) => s.$project && s.$project.attachments));
});

test('tracking onboard stages skip range match when dates absent', () => {
  const stages = trackingOnboardDateStages(null, null);
  assert.equal(stages.length, 2);
  assert.ok(assetOnboardDateExpression().$let);
});

test('tracking eligible assets pipeline projects lean fields only', () => {
  const pipeline = trackingEligibleAssetsPipeline(null, null);
  const project = pipeline.find((s) => s.$project);
  assert.ok(project.$project._id);
  assert.ok(project.$project.lastVerifiedAt);
  assert.equal(project.$project.attachments, undefined);
  assert.equal(project.$project.providerEmployees, undefined);
});

test('formatTrackingInventoryBuckets orders canonical statuses first', () => {
  const { inventoryQty, inventoryValue, assetStatus } = formatTrackingInventoryBuckets([
    { _id: 'Agreement Signed', qty: 2, value: 100 },
    { _id: 'Legacy Weird', qty: 1, value: 50 },
  ]);
  assert.equal(inventoryQty, 3);
  assert.equal(inventoryValue, 150);
  assert.equal(assetStatus[0].status, ASSET_STATUS_OPTIONS[0]);
  assert.ok(assetStatus.some((b) => b.status === 'Agreement Signed' && b.qty === 2));
  assert.ok(assetStatus.some((b) => b.status === 'Legacy Weird' && b.qty === 1));
});
