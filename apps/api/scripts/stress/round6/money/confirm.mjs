// Re-runs every finding on a brand-new Brazil School (nothing else on it),
// to show it is the product and not the harness.
import { call, must, db, rec, expect, makeSchool, makeMember, plan, series, charges, d, addDays, todayIn, saveOut } from './lib.mjs';
import { dist, jobsDb, done } from './common.mjs';

const A = 'confirm';
const s = await makeSchool('br', 'M6 Clean');
const O = () => s.owner.tok;
const tz = s.c.tz;
const T = todayIn(tz);
const fmt = (x) => (x ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x) : null);
const { runSeries } = dist('charges/recurring-occurrences');
const { applyDueMinimumTermEnds } = dist('memberships/contracts/minimum-term');
await must('fees on', 'PATCH', `/schools/${s.id}`, O(), { joiningFeesEnabled: true });
await db.school.update({ where: { id: s.id }, data: { freezeMaxDaysPer12Months: 365 } });
async function buy(member, planId, extra = {}) {
  const b = await must('buy', 'POST', `/membership-plans/${planId}/purchase`, member.tok, extra);
  await must('confirm', 'PATCH', `/transactions/${b.transactionId}/confirm`, O(), {});
  await new Promise((r) => setTimeout(r, 800));
  return { m: await db.membership.findFirst({ where: { studentId: member.id, membershipPlanId: planId, status: 'ACTIVE' } }), txId: b.transactionId };
}

// M-1: freeze inside a 3-month "ends after the minimum term" contract.
const cp = await plan(s, { type: 'SUBSCRIPTION', title: 'Contrato 3 meses', price: 15000 });
const c = await must('contract', 'PUT', `/membership-plans/${cp.id}/contract`, O(), { body: 'Contrato.', minimumTermMonths: 3, earlyExitFee: 5000, endsAfterMinimumTerm: true });
const u1 = await makeMember(s, 'Eva', 'Um');
const sig = await must('sign', 'POST', `/membership-plans/${cp.id}/contract/sign`, u1.tok, { signerFullName: 'Eva Um', signatureText: 'Eva', contractVersion: c.contractVersion ?? 1 });
const { m: m1 } = await buy(u1, cp.id, { contractSignatureId: sig.id ?? sig.signatureId });
await must('freeze', 'POST', `/schools/${s.id}/memberships/${m1.id}/freezes`, O(), { startsAt: addDays(T, 24), endsAt: addDays(T, 54) });
const sr1 = await series(m1.id);
for (let n = 0; n <= 140; n++) {
  const now = new Date(Date.now() + n * 86400e3);
  await runSeries(jobsDb, sr1.id, now);
  await applyDueMinimumTermEnds(jobsDb, null, console, now).catch(() => 0);
}
const ch1 = await charges(sr1.id);
const m1b = await db.membership.findUnique({ where: { id: m1.id } });
const payments = 1 + ch1.length;
expect(A, 'M-1 clean: 3-month contract with a 30-day freeze is billed 3 times (order + 2), not 4', payments === 3, { start: T, freeze: [addDays(T, 24), addDays(T, 54)], charged: ch1.map((x) => d(x.occurrenceDate)), termEnd: fmt(m1b.cancelAt), payments });

// M-2: cancel during a freeze, then the freeze is ended early the same day.
const mp = await plan(s, { type: 'SUBSCRIPTION', title: 'Mensal', price: 9990 });
const u2 = await makeMember(s, 'Ivo', 'Dois');
const { m: m2 } = await buy(u2, mp.id);
const f2 = await must('freeze', 'POST', `/schools/${s.id}/memberships/${m2.id}/freezes`, O(), { startsAt: T, endsAt: addDays(T, 30) });
await must('cancel', 'POST', `/memberships/${m2.id}/cancel`, u2.tok, {});
await must('end', 'POST', `/schools/${s.id}/freezes/${f2.id}/end`, O(), {});
const m2b = await db.membership.findUnique({ where: { id: m2.id } });
const card = await call('GET', `/schools/${s.id}/students/${u2.id}/memberships`, O());
const row = (card.body?.memberships ?? card.body?.items ?? card.body ?? []).find?.((x) => x.id === m2.id);
expect(A, 'M-2 clean: after the early end, the end date shown (cancelAt) = the real end (expiryDate)', fmt(m2b.cancelAt) === fmt(m2b.expiryDate), { cancelAt: fmt(m2b.cancelAt), expiryDate: fmt(m2b.expiryDate), portalRow: row && { cancelAt: row.cancelAt, expiryDate: row.expiryDate } });

// M-3: desk refund with "end the membership": the series on the member's page.
const fp = await plan(s, { type: 'SUBSCRIPTION', title: 'Mensal taxa', price: 18990, joiningFee: 5000, joiningFeeRefundable: false });
const u3 = await makeMember(s, 'Rosa', 'Tres');
const { m: m3, txId: t3 } = await buy(u3, fp.id);
const rf = await must('refund', 'POST', `/transactions/${t3}/refund`, O(), { amount: 18990, notes: 'devolvido', endMembership: true });
const rc = await call('GET', `/schools/${s.id}/students/${u3.id}/recurring-charges`, O());
const rrow = (Array.isArray(rc.body) ? rc.body : rc.body?.items ?? []).find?.((x) => x.membershipId === m3.id) ?? (Array.isArray(rc.body) ? rc.body : rc.body?.items ?? [])[0];
const m3b = await db.membership.findUnique({ where: { id: m3.id } });
expect(A, 'M-3 clean: refunded and ended: the monthly charge no longer shows a next date', m3b.status === 'EXPIRED' && (!rrow?.nextDate || rrow?.status !== 'ACTIVE'), { membership: m3b.status, recurring: rrow && { status: rrow.status, nextDate: rrow.nextDate, endDate: rrow.endDate } });

// M-4: the same payment (23990, non-refundable fee 5000 kept): what the reports count.
const t3b = await db.transaction.findUnique({ where: { id: t3 } });
const ov = (await call('GET', `/schools/${s.id}/charge-reports/overview`, O())).body?.currencies?.find((x) => x.currency === 'BRL');
const sum = (await call('GET', `/schools/${s.id}/transactions/summary`, O())).body;
const rev = sum?.revenue?.find((x) => x.currency === 'BRL')?.amount ?? 0;
// Every membership payment on this School: 150.00 (M-1) + 99.90 (M-2) + the 50.00 kept here = 299.90.
expect(A, 'M-4 clean: the R$50.00 joining fee kept after the refund is in the revenue figures (want 299.90)', (ov?.memberships ?? 0) === 29990 && rev === 29990, { payment: { amount: t3b.amount, refunded: t3b.refundedAmount, status: t3b.status }, overviewMemberships: ov?.memberships ?? 0, summaryRevenue: rev, kept: t3b.amount - t3b.refundedAmount });

saveOut('confirm-out.json');
await done();
