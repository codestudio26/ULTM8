// Attack T: report totals against the rows underneath (charge-reports
// overview and member balances, the Transactions summary and list), on the
// three Schools after the other scripts ran. Adds desk payments of monthly
// charges (part, overpay, refund) at the Brazil School first.
import { call, must, db, rec, expect, saveOut, d } from './lib.mjs';
import { school, done } from './common.mjs';
import { DateTime } from 'luxon';

const A = 'totals';
const br = await school('br');
// Desk payments of balance-billed months at the Brazil School.
const unpaid = (await db.charge.findMany({ where: { schoolId: br.id, cancelledAt: null, recurringChargeId: { not: null }, allocations: { none: {} } }, include: { allocations: true }, orderBy: { createdAt: 'asc' } })).filter((c, i, a) => a.findIndex((x) => x.studentId === c.studentId) === i).slice(0, 3);
const pays = [];
for (const [i, c] of unpaid.entries()) {
  const amount = i === 0 ? 5000 : i === 1 ? c.grossAmount + 1234 : c.grossAmount; // part, overpay (credit), exact
  pays.push(await call('POST', `/schools/${br.id}/students/${c.studentId}/charge-payments`, br.owner.tok, { chargeId: c.id, amount, paymentMethod: 'CASH' }));
}
rec(A, 'T0 desk payments of monthly charges (part, overpay, exact)', pays.every((p) => p.status < 300) ? 'PASS' : 'FAIL', pays.map((p) => [p.status, p.body?.error?.message ?? p.body?.transactionId ?? p.body?.id]));
const refundTx = pays[2]?.body?.transactionId ?? pays[2]?.body?.transaction?.id ?? pays[2]?.body?.id;
if (refundTx) {
  const rf = await call('POST', `/schools/${br.id}/charge-payments/${refundTx}/refund`, br.owner.tok, { amount: 1000, notes: 'devolvido' });
  rec(A, 'T0b part-refund of a desk charge payment', rf.status < 300 ? 'PASS' : 'NOTE', { status: rf.status, err: rf.body?.error?.message });
}

for (const k of ['ready', 'notready', 'br']) {
  const s = await school(k);
  const zone = s.c.tz;
  const ov = (await call('GET', `/schools/${s.id}/charge-reports/overview`, s.owner.tok)).body;
  const mb = (await call('GET', `/schools/${s.id}/charge-reports/member-balances`, s.owner.tok)).body;
  const sum = (await call('GET', `/schools/${s.id}/transactions/summary`, s.owner.tok)).body;
  
  // The truth, from the rows.
  const today = DateTime.now().setZone(zone).toISODate();
  const charges = await db.charge.findMany({ where: { schoolId: s.id, cancelledAt: null }, include: { allocations: true } });
  let scheduled = 0, overdue = 0;
  for (const c of charges) {
    const owed = Math.max(0, c.grossAmount - c.allocations.reduce((n, a) => n + a.amount, 0) - (c.writtenOffAmount ?? 0));
    if (!owed) continue;
    if (d(c.dueDate) < today) overdue += owed; else scheduled += owed;
  }
  const txs = await db.transaction.findMany({ where: { schoolId: s.id } });
  const memRev = txs.filter((t) => ['MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE', 'FREEZE_FEE'].includes(t.kind) && t.status === 'SUCCESSFUL').reduce((n, t) => n + Math.max(0, t.amount - (t.refundedAmount ?? 0)), 0);
  const memRevAll = txs.filter((t) => ['MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE', 'FREEZE_FEE'].includes(t.kind) && ['SUCCESSFUL', 'REFUNDED'].includes(t.status)).reduce((n, t) => n + Math.max(0, t.amount - (t.refundedAmount ?? 0)), 0);
  const be = await db.balanceEntry.findMany({ where: { schoolId: s.id } });
  const received = be.filter((e) => e.kind === 'PAYMENT').reduce((n, e) => n - e.amount, 0);
  const refunded = be.filter((e) => e.kind === 'REFUND').reduce((n, e) => n + e.amount, 0);
  const cur = ov?.currencies?.find((c) => c.currency === s.c.cur) ?? {};
  expect(A, `T1 ${k}: overview scheduled/overdue = the unpaid charges`, cur.scheduled === scheduled && cur.overdue === overdue, { report: { scheduled: cur.scheduled, overdue: cur.overdue }, rows: { scheduled, overdue } });
  expect(A, `T2 ${k}: overview paid (received − refunded) = the balance payment/refund entries`, (cur.paid ?? 0) === received - refunded, { report: cur.paid, rows: { received, refunded } });
  expect(A, `T3 ${k}: overview membership revenue = successful membership-type payments net of refunds`, (cur.memberships ?? 0) === memRev, { report: cur.memberships, rows: memRev, includingFullyRefundedRows: memRevAll });
  // Member balances: each member's net = the sum of their balance entries.
  const nets = new Map();
  for (const e of be) nets.set(`${e.studentId}:${e.currency}`, (nets.get(`${e.studentId}:${e.currency}`) ?? 0) + e.amount);
  const items = mb?.items ?? [];
  const bad = items.filter((r) => nets.get(`${r.studentId}:${r.currency}`) !== r.net);
  const missing = [...nets.entries()].filter(([key, v]) => v !== 0 && !items.find((r) => `${r.studentId}:${r.currency}` === key));
  expect(A, `T4 ${k}: member balances = the sum of each member's balance entries (none missing)`, bad.length === 0 && missing.length === 0, { rows: items.length, bad: bad.slice(0, 3), missing: missing.slice(0, 3) });
  const owedSum = items.reduce((n, r) => n + r.owed, 0);
  expect(A, `T5 ${k}: member balances' owed adds up to the overview's scheduled + overdue`, owedSum === (cur.scheduled ?? 0) + (cur.overdue ?? 0) || items.length === 0, { owedSum, overview: (cur.scheduled ?? 0) + (cur.overdue ?? 0) });
  // Transactions summary vs rows.
  const succ = txs.filter((t) => t.status === 'SUCCESSFUL' && (t.currency ?? '').toUpperCase() === s.c.cur).reduce((n, t) => n + t.amount, 0);
  const rev = (sum?.revenue ?? sum?.revenueByCurrency ?? []).find?.((r) => (r.currency ?? '').toUpperCase() === s.c.cur)?.amount;
  expect(A, `T6 ${k}: Transactions summary revenue = the successful rows' amounts`, rev === succ || (rev === undefined && succ === 0), { summary: rev, rows: succ, keys: Object.keys(sum ?? {}) });
  const partRefunded = txs.filter((t) => t.status === 'SUCCESSFUL' && t.refundedAmount > 0);
  const surch = txs.filter((t) => t.status === 'SUCCESSFUL').reduce((n, t) => n + (t.surchargeAmount ?? 0), 0);
  rec(A, `T7 ${k}: what the two pages count differently`, 'NOTE', { summaryRevenueIncludesPartRefunds: partRefunded.map((t) => ({ amount: t.amount, refunded: t.refundedAmount, status: t.status, kind: t.kind })), surchargeCollectedNotInEither: surch, overviewMemberships: cur.memberships, summaryRevenue: rev });
  expect(A, `T8 ${k}: Transactions summary counts every row`, sum?.total === txs.length, { summaryTotal: sum?.total, rows: txs.length });
}
saveOut('totals-out.json');
await done();
