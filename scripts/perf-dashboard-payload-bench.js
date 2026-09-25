/**
 * Measurable before/after for dashboard finance payload shape (no DB required).
 * Simulates old full-document hydrate vs new aggregate summary.
 */
import assert from 'node:assert/strict';
import {
  summarizeCommercialAggregates,
  firstGroupRow,
} from '../src/modules/dashboards/dashboard.aggregations.js';

function fakeExpenseDocs(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `e${i}`,
    amount: 100 + (i % 50),
    status: i % 3 === 0 ? 'Draft' : 'Paid',
    notes: 'x'.repeat(200),
    attachments: [{ url: `/uploads/e${i}.pdf`, name: 'receipt.pdf' }],
  }));
}

function fakeCommercialDocs(n) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `c${i}`,
    documentType: i % 2 === 0 ? 'client_invoice' : 'proforma',
    status: i % 4 === 0 ? 'Draft' : 'Submitted',
    grandTotal: 1000 + i,
    lineItems: Array.from({ length: 20 }, () => ({ desc: 'item', qty: 1, rate: 50 })),
  }));
}

const expenses = fakeExpenseDocs(2000);
const commercial = fakeCommercialDocs(1500);

const beforeBytes = Buffer.byteLength(JSON.stringify({ expenses, commercial }), 'utf8');

const expenseAgg = [
  {
    total: expenses.reduce((s, r) => s + r.amount, 0),
    open: expenses.filter((r) => r.status === 'Draft').length,
    count: expenses.length,
  },
];
const commercialAgg = [];
for (const row of commercial) {
  const key = `${row.documentType}|${row.status}`;
  let hit = commercialAgg.find((x) => `${x._id.documentType}|${x._id.status}` === key);
  if (!hit) {
    hit = {
      _id: { documentType: row.documentType, status: row.status },
      count: 0,
      grandTotal: 0,
    };
    commercialAgg.push(hit);
  }
  hit.count += 1;
  hit.grandTotal += row.grandTotal;
}

const afterPayload = {
  expense: firstGroupRow(expenseAgg),
  commercial: summarizeCommercialAggregates(commercialAgg),
};
const afterBytes = Buffer.byteLength(JSON.stringify(afterPayload), 'utf8');

assert.ok(afterBytes < beforeBytes);
const reductionPct = (((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(1);

console.log(
  JSON.stringify(
    {
      scenario: 'dashboard finance overview payload',
      docs: { expenses: expenses.length, commercial: commercial.length },
      beforeBytes,
      afterBytes,
      reductionPct: Number(reductionPct),
      afterPayload,
    },
    null,
    2,
  ),
);
