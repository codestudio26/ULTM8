// Attack C: a contract's minimum term on a monthly plan billed to the
// balance (Decisions 316 item 6, 435 items 16-21, 436 item 12), and Delete my
// account in the middle of the monthly series (Decisions 436 items 1-4, 440).
import { call, must, db, rec, expect, makeMember, job, series, charges, d, addDays, todayIn, backdate, saveOut, stepUp } from './lib.mjs';
import { school, dist, jobsDb, done } from './common.mjs';

const A = 'contract-delete';
const s = await school('br');
const O = () => s.owner.tok;
const tz = s.c.tz;
const T = todayIn(tz);
const fmt = (x) => (x ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x) : null);
const { runSeries } = dist('charges/recurring-occurrences');
const tag = Date.now().toString(36);
await db.school.update({ where: { id: s.id }, data: { freezeMaxDaysPer12Months: 365, freezeFeeAmount: null } });

async function contractPlan(endsAfter) {
  const p = await must('plan', 'POST', `/schools/${s.id}/membership-plans`, O(), { type: 'SUBSCRIPTION', title: `Contrato ${endsAfter ? 'fim' : 'saida'} ${tag}`, price: 15000, currency: 'BRL' });
  const c = await must('contract', 'PUT', `/membership-plans/${p.id}/contract`, O(), { body: 'Contrato de 3 meses.', minimumTermMonths: 3, earlyExitFee: 5000, endsAfterMinimumTerm: endsAfter });
  return { ...p, contractVersion: c.contractVersion ?? 1 };
}
async function signAndBuy(member, p) {
  const sig = await must('sign', 'POST', `/membership-plans/${p.id}/contract/sign`, member.tok, { signerFullName: `${member.first} ${member.last}`, signatureText: member.first, contractVersion: p.contractVersion });
  const b = await must('buy', 'POST', `/membership-plans/${p.id}/purchase`, member.tok, { contractSignatureId: sig.id ?? sig.signatureId });
  await must('confirm', 'PATCH', `/transactions/${b.transactionId}/confirm`, O(), {});
  await new Promise((r) => setTimeout(r, 800));
  return db.membership.findFirst({ where: { studentId: member.id, membershipPlanId: p.id, status: 'ACTIVE' } });
}

// C1: cancelling early at a no-card School: the early-exit fee once, on the balance.
const exitPlan = await contractPlan(false);
const c1 = await makeMember(s, 'Carla', 'Contrato');
const m1 = await signAndBuy(c1, exitPlan);
const [x1, x2] = await Promise.all([call('POST', `/memberships/${m1.id}/cancel`, c1.tok, {}), call('POST', `/memberships/${m1.id}/cancel`, c1.tok, {})]);
await new Promise((r) => setTimeout(r, 1000));
const fees = await db.charge.findMany({ where: { studentId: c1.id, schoolId: s.id, recurringChargeId: null } });
const m1b = await db.membership.findUnique({ where: { id: m1.id } });
expect(A, 'C1 member cancels inside the term (twice at once): one early-exit fee of 50.00 BRL on the balance; ends at the next billing day', fees.length === 1 && fees[0].grossAmount === 5000 && fees[0].currency === 'BRL' && fmt(m1b.cancelAt) === addDays(T, 30), { cancels: [x1.status, x2.status], fees: fees.map((f) => ({ desc: f.description, gross: f.grossAmount, cur: f.currency })), cancelAt: fmt(m1b.cancelAt) });

// C2: "ends after the minimum term": stops on the term's last day, the month on that day not charged.
const endPlan = await contractPlan(true);
const c2 = await makeMember(s, 'Davi', 'Termo');
const m2 = await signAndBuy(c2, endPlan);
await backdate(m2.id, 85); // term (3 months) ends within 10 days
await job('membership-expiry-sweep');
const m2b = await db.membership.findUnique({ where: { id: m2.id } });
const sr2 = await series(m2.id);
const termEnd = fmt(m2b.cancelAt);
// The charge-recurring job runs on every day up to the term end.
for (const day of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await runSeries(jobsDb, sr2.id, new Date(Date.now() + day * 86400e3));
const ch2 = await charges(sr2.id);
expect(A, 'C2 ends after the minimum term: cancelAt = start + 3 months; no month charged on or after it', !!termEnd && ch2.every((c) => d(c.occurrenceDate) < termEnd), { start: fmt(m2b.startDate), termEnd, charged: ch2.map((c) => d(c.occurrenceDate)) });
expect(A, 'C2b over the 3-month term: exactly 2 more months charged after the first (paid as the order)', ch2.length === 2, ch2.map((c) => d(c.occurrenceDate)));

// C3: a freeze inside the term pushes the term end by the frozen days; the billing days move by the same days.
const c3 = await makeMember(s, 'Edu', 'Gelo');
const m3 = await signAndBuy(c3, endPlan);
// Billing day the 7th (bought today); a 30-day freeze from in 24 days.
const fz = await call('POST', `/schools/${s.id}/memberships/${m3.id}/freezes`, O(), { startsAt: addDays(T, 24), endsAt: addDays(T, 54) });
const sr3 = await series(m3.id);
// Live through the whole term: run the sweep and the series every day for 140 days.
const days = [];
for (let n = 0; n <= 140; n++) {
  const now = new Date(Date.now() + n * 86400e3);
  await runSeries(jobsDb, sr3.id, now);
  if (n % 5 === 0 || n > 110) {
    const { applyDueMinimumTermEnds } = dist('memberships/contracts/minimum-term');
    await applyDueMinimumTermEnds(jobsDb, null, console, now).catch(() => 0);
  }
}
const m3b = await db.membership.findUnique({ where: { id: m3.id } });
const ch3 = await charges(sr3.id);
const ends = fmt(m3b.cancelAt);
const lastCharge = d(ch3.at(-1)?.occurrenceDate);
rec(A, 'C3 a 30-day freeze inside a 3-month "ends after the term" plan: the months charged and the end', 'NOTE', { freeze: [addDays(T, 24), addDays(T, 54)], freezeStatus: fz.status, charged: ch3.map((c) => d(c.occurrenceDate)), termEnd: ends, daysCoveredByLastMonth: lastCharge && ends ? (Date.parse(ends) - Date.parse(lastCharge)) / 86400e3 : null });

// C4: Delete my account mid-series: monthly charges stop at once; an unpaid month stays as a debt.
const c4 = await makeMember(s, 'Fabi', 'Apagar');
const p4 = await must('p4', 'POST', `/schools/${s.id}/membership-plans`, O(), { type: 'SUBSCRIPTION', title: `Mensal ${tag}`, price: 9990, currency: 'BRL' });
const b4 = await must('buy', 'POST', `/membership-plans/${p4.id}/purchase`, c4.tok, {});
await must('confirm', 'PATCH', `/transactions/${b4.transactionId}/confirm`, O(), {});
await new Promise((r) => setTimeout(r, 800));
const m4 = await db.membership.findFirst({ where: { studentId: c4.id, membershipPlanId: p4.id } });
await backdate(m4.id, 35);
await job('charge-recurring');
const sr4 = await series(m4.id);
const before4 = await charges(sr4.id);
const del = await call('POST', '/users/me/deletion', c4.tok, {}, { 'x-step-up-token': await stepUp(c4) });
const m4b = await db.membership.findUnique({ where: { id: m4.id } });
const sr4b = await series(m4.id);
expect(A, 'C4 delete my account: the balance-billed plan is cancelled at once (next billing day), series ends', del.status < 300 && !!m4b.cancelAt && (!!sr4b.endDate || !sr4b.nextDate), { del: del.status, err: del.body?.error?.message, cancelAt: fmt(m4b.cancelAt), series: { next: d(sr4b.nextDate), end: d(sr4b.endDate) }, unpaidBefore: before4.map((c) => [d(c.occurrenceDate), c.status ?? c.paidAmount]) });
// 30 days later the daily erasure runs.
await db.user.update({ where: { id: c4.id }, data: { deletionDueAt: new Date(Date.now() - 60e3) } });
await job('account-erasure');
for (const n of [30, 31, 32, 60]) await runSeries(jobsDb, sr4.id, new Date(Date.now() + n * 86400e3));
const after4 = await charges(sr4.id);
const u4 = await db.user.findUnique({ where: { id: c4.id }, select: { firstName: true, email: true, erasedAt: true } }).catch(async () => db.user.findUnique({ where: { id: c4.id }, select: { firstName: true } }));
const bal = await call('GET', `/schools/${s.id}/charge-reports/member-balances`, O());
const row = (bal.body?.rows ?? bal.body?.items ?? bal.body ?? []).find?.((r) => r.studentId === c4.id);
expect(A, 'C4b after the erasure: no new month; the unpaid month stays on the School\'s books as "Erased User"', after4.length === before4.length && u4?.firstName === 'Erased' || (after4.length === before4.length && /Erased/.test(JSON.stringify(row ?? u4))), { before: before4.length, after: after4.length, user: u4, balanceRow: row ?? bal.status });

saveOut('contract-delete-out.json');
await done();
