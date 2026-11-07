// Attack A: monthly plans at a School without cards (Decision 441 item 1,
// #510; Decision 442 item 5 kept-as-built list). Brazil School from cast.json.
import { call, must, db, rec, expect, makeMember, job, series, charges, d, addDays, todayIn, backdate, buyMonthly, signIn, saveOut, stepUp } from './lib.mjs';
import { school, dist, jobsDb, done } from './common.mjs';

const A = 'monthly';
const s = await school('br');
const O = () => s.owner.tok;
const P = s.plans;
const tz = s.c.tz;
const today = todayIn(tz);
const { runSeries } = dist('charges/recurring-occurrences');

// A1: buy in app -> Pix order, joining fee on the first payment only.
const m1 = await makeMember(s, 'Lucas', 'Um');
const b1 = await call('POST', `/membership-plans/${P.monthly}/purchase`, m1.tok, {});
const t1 = b1.body?.transactionId ? await db.transaction.findUnique({ where: { id: b1.body.transactionId } }) : null;
expect(A, 'A1 buy monthly in app at a no-card School is a waiting Pix order with the joining fee', b1.status < 300 && b1.body.outcome === 'pending_confirmation' && t1?.amount === 18990 + 5000 && t1?.paymentMethod === 'BANK_TRANSFER' && t1?.joiningFeeAmount === 5000, { status: b1.status, outcome: b1.body?.outcome, amount: t1?.amount, method: t1?.paymentMethod, fee: t1?.joiningFeeAmount });
const b1b = await call('POST', `/membership-plans/${P.monthly}/purchase`, m1.tok, {});
expect(A, 'A2 a second tap returns the same waiting order', b1b.body?.transactionId === b1.body?.transactionId, { first: b1.body?.transactionId, second: b1b.body?.transactionId });

// A3: Branch Staff with "record payments" and the owner confirm at the same moment.
const staff = await makeMember(s, 'Mariana', 'Staff');
await must('grant', 'POST', `/users/${staff.id}/role-grants`, O(), { role: 'BRANCH_STAFF', schoolId: s.id, branchId: s.branch.id });
await must('rec pay', 'PATCH', `/schools/${s.id}`, O(), { branchStaffCanRecordPayments: true });
await signIn(staff);
const [c1, c2, c3] = await Promise.all([
  call('PATCH', `/transactions/${b1.body.transactionId}/confirm`, O(), {}),
  call('PATCH', `/transactions/${b1.body.transactionId}/confirm`, staff.tok, {}),
  call('PATCH', `/transactions/${b1.body.transactionId}/confirm`, O(), {}),
]);
await new Promise((r) => setTimeout(r, 1500));
const ms1 = await db.membership.findMany({ where: { studentId: m1.id, membershipPlanId: P.monthly } });
const sr1 = ms1[0] ? await series(ms1[0].id) : null;
expect(A, 'A3 triple confirm (owner x2 + Branch Staff at once) makes one membership and one monthly series', ms1.length === 1 && !!sr1 && ms1[0].billedToBalance, { statuses: [c1.status, c2.status, c3.status], memberships: ms1.length, billedToBalance: ms1[0]?.billedToBalance, series: !!sr1 });
expect(A, 'A4 the series bills the plan price (not price + joining fee), monthly from the start day', sr1?.unitAmount === 18990 && sr1?.currency === 'BRL' && d(sr1?.firstDate) === today && d(sr1?.nextDate) === addDays(today, 30) && sr1?.nextIndex === 1, { unit: sr1?.unitAmount, cur: sr1?.currency, first: d(sr1?.firstDate), next: d(sr1?.nextDate), idx: sr1?.nextIndex, today });

// A5: confirm and cancel the same order at the same moment.
const m2 = await makeMember(s, 'Pedro', 'Dois');
const b2 = await must('buy', 'POST', `/membership-plans/${P.monthly}/purchase`, m2.tok, {});
const [cf, cn] = await Promise.all([
  call('PATCH', `/transactions/${b2.transactionId}/confirm`, O(), {}),
  call('PATCH', `/transactions/${b2.transactionId}/cancel`, O(), { reason: 'race' }),
]);
await new Promise((r) => setTimeout(r, 1500));
const t2 = await db.transaction.findUnique({ where: { id: b2.transactionId } });
const ms2 = await db.membership.findMany({ where: { studentId: m2.id } });
const sr2 = ms2[0] ? await series(ms2[0].id) : null;
const consistent = (t2.status === 'SUCCESSFUL' && ms2.length === 1 && !!sr2) || (t2.status === 'FAILED' && ms2.length === 0 && !sr2);
expect(A, 'A5 confirm vs cancel at once: one wins, never both', consistent, { confirm: cf.status, cancel: cn.status, cancelBody: cn.body?.cancelled ?? cn.body?.error?.code, txStatus: t2.status, memberships: ms2.length, series: !!sr2 });

// A6: the charge-recurring job after missed days (catch-up), rerun, and two at once.
const m3 = await makeMember(s, 'Rafa', 'Tres');
const { m: mem3 } = await buyMonthly(s, m3, P.monthly);
await new Promise((r) => setTimeout(r, 800));
await backdate(mem3.id, 100); // 100 days later: 3 billing days passed without a run
const sr3 = await series(mem3.id);
const expectDays = [1, 2, 3].map((i) => {
  const f = d(sr3.firstDate); const [y, mo, dd] = f.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + i, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`;
}).filter((x) => x <= today);
const jobsP = await Promise.allSettled([runSeries(jobsDb, sr3.id, new Date()), runSeries(jobsDb, sr3.id, new Date()), job('charge-recurring')]);
await job('charge-recurring');
const ch3 = await charges(sr3.id);
expect(A, 'A6 catch-up after missed days: one charge per missed billing day, never twice (two runs at once + the job + a rerun)', ch3.length === expectDays.length && new Set(ch3.map((c) => d(c.occurrenceDate))).size === ch3.length && ch3.every((c, i) => d(c.occurrenceDate) === expectDays[i]), { want: expectDays, got: ch3.map((c) => d(c.occurrenceDate)), runs: jobsP.map((r) => r.status) });
expect(A, 'A7 each month is the plan price, BRL, due on its own day, with its own invoice number', ch3.every((c) => c.grossAmount === 18990 && c.currency === 'BRL' && d(c.dueDate) === d(c.occurrenceDate)) && new Set(ch3.map((c) => c.invoiceNumber)).size === ch3.length, ch3.map((c) => ({ gross: c.grossAmount, net: c.netAmount, tax: c.taxAmount, cur: c.currency, due: d(c.dueDate), inv: c.invoiceNumber })));

// A8: the member cancels -> ends on the next billing day; nothing charged on or after it.
const can3 = await call('POST', `/memberships/${mem3.id}/cancel`, m3.tok, {});
const mem3b = await db.membership.findUnique({ where: { id: mem3.id } });
const sr3b = await series(mem3.id);
expect(A, 'A8 member cancels: ends at the start of the next billing day; series ends the day before', can3.status < 300 && d(sr3b.endDate) === addDays(d(sr3.nextDate) > today ? d((await series(mem3.id)).nextDate ?? sr3b.endDate) : today, -1) || (can3.status < 300 && !!mem3b.cancelAt && !sr3b.nextDate), { status: can3.status, cancelAt: mem3b.cancelAt, expiry: mem3b.expiryDate, endDate: d(sr3b.endDate), nextDate: d(sr3b.nextDate) });
await backdate(mem3.id, 70);
await job('charge-recurring');
const ch3b = await charges(sr3.id);
const mem3c = await db.membership.findUnique({ where: { id: mem3.id } });
const cancelDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(mem3c.cancelAt);
expect(A, 'A9 after the cancel day passes (70 more days), no new month is charged', ch3b.length === ch3.length, { cancelDayAfterClockMove: cancelDay, before: ch3.map((c) => d(c.occurrenceDate)), after: ch3b.map((c) => d(c.occurrenceDate)) });

// A10: owner cancels; a parent cancels for a child.
const m4 = await makeMember(s, 'Bia', 'Quatro');
const { m: mem4 } = await buyMonthly(s, m4, P.monthly2);
const oc = await call('POST', `/memberships/${mem4.id}/cancel`, O(), {});
expect(A, 'A10 owner cancels a balance-billed monthly plan', oc.status < 300 && !!oc.body?.cancelAt, { status: oc.status, cancelAt: oc.body?.cancelAt, err: oc.body?.error?.message });
const parent = await makeMember(s, 'Ana', 'Mae');
const kid = await must('child', 'POST', '/guardians/me/minors', parent.tok, { firstName: 'Kid', surname: 'Filho', dateOfBirth: '2016-05-20', consentPolicyVersion: '1.0-placeholder' });
kid.id = kid.studentId;
const kj = await call('POST', `/schools/${s.id}/join`, parent.tok, { branchId: s.branch.id, studentId: kid.id });
const kb = await call('POST', `/membership-plans/${P.monthly2}/purchase`, parent.tok, { studentId: kid.id });
let kidMem = null;
if (kb.body?.transactionId) {
  await call('PATCH', `/transactions/${kb.body.transactionId}/confirm`, O(), {});
  kidMem = await db.membership.findFirst({ where: { studentId: kid.id, status: 'ACTIVE' } });
}
const pc = kidMem ? await call('POST', `/memberships/${kidMem.id}/cancel`, parent.tok, { studentId: kid.id }) : null;
expect(A, 'A11 a parent buys a monthly plan for a child by Pix and cancels it', !!kidMem && kidMem.billedToBalance && pc?.status < 300, { join: kj.status, buy: kb.status, buyBody: kb.body?.outcome ?? kb.body?.error?.message, mem: !!kidMem, cancel: pc?.status, cancelErr: pc?.body?.error?.message });

// A12: price change after purchase: the member keeps the price they bought at.
const m5 = await makeMember(s, 'Caio', 'Cinco');
const { m: mem5 } = await buyMonthly(s, m5, P.monthly2);
const bought5 = (await db.membershipPlan.findUnique({ where: { id: P.monthly2 } })).price;
const pch = await call('PATCH', `/membership-plans/${P.monthly2}`, O(), { price: bought5 + 111 });
await backdate(mem5.id, 31);
await job('charge-recurring');
const sr5 = await series(mem5.id);
const ch5 = await charges(sr5.id);
expect(A, 'A12 price change after purchase: the next month is still the bought price', pch.status < 300 && ch5.length === 1 && ch5[0].grossAmount === bought5, { bought: bought5, patch: pch.status, err: pch.body?.error?.message, charged: ch5.map((c) => c.grossAmount) });
const notes5 = await db.notification.findMany({ where: { userId: m5.id }, select: { title: true, body: true } }).catch(() => []);
rec(A, 'A12b notices the member got after the price change', 'NOTE', notes5.map((n) => n.title));

// A13: late fee on an unpaid month (Decision 413 rules).
const lf = await call('PUT', `/schools/${s.id}/late-fees`, O(), { enabled: true, type: 'FIXED', fixedAmount: 1000, graceDays: 3, legalConfirmed: true });
await db.school.update({ where: { id: s.id }, data: { lateFeeEnabledAt: new Date(Date.now() - 200 * 86400e3) } });
const m6 = await makeMember(s, 'Duda', 'Seis');
const { m: mem6 } = await buyMonthly(s, m6, P.monthly);
await backdate(mem6.id, 40); // a month due 10 days ago, unpaid
await job('charge-recurring');
await Promise.allSettled([job('late-fee'), job('late-fee')]);
await job('late-fee');
const sr6 = await series(mem6.id);
const ch6 = await charges(sr6.id);
const fees6 = await db.charge.findMany({ where: { studentId: m6.id, lateFeeForChargeId: { not: null } } });
expect(A, 'A13 an unpaid month past grace gets one late fee (job run three times)', ch6.length === 1 && fees6.length === 1 && fees6[0].lateFeeForChargeId === ch6[0].id && fees6[0].grossAmount === 1000, { lateFeeSet: lf.status, months: ch6.length, fees: fees6.map((f) => ({ for: f.lateFeeForChargeId === ch6[0]?.id, gross: f.grossAmount, cur: f.currency })) });
const bal6 = await call('GET', `/students/${m6.id}/charges?schoolId=${s.id}`, m6.tok);
rec(A, 'A13b member sees their charges', 'NOTE', { status: bal6.status, n: Array.isArray(bal6.body) ? bal6.body.length : bal6.body?.charges?.length, keys: Object.keys(bal6.body ?? {}).slice(0, 6) });

// A14: an unpaid month doesn't stop training (kept as built): the membership is still in effect.
const st6 = await call('GET', `/students/${m6.id}/membership-status?schoolId=${s.id}`, O());
rec(A, 'A14 membership status with an unpaid month', 'NOTE', st6.body);

// A15: member removed mid-series: the series stops, nothing more charged.
const m7 = await makeMember(s, 'Gabi', 'Sete');
const { m: mem7 } = await buyMonthly(s, m7, P.monthly2);
const grants7 = await db.roleGrant.findMany({ where: { userId: m7.id, schoolId: s.id, role: 'STUDENT', revokedAt: null } });
const rm = await call('DELETE', `/users/${m7.id}/role-grants/${grants7[0].id}`, O());
const rm2 = null;
await backdate(mem7.id, 65);
await job('charge-recurring');
const sr7 = await series(mem7.id);
const ch7 = await charges(sr7.id);
const mem7b = await db.membership.findUnique({ where: { id: mem7.id } });
expect(A, 'A15 member removed: their monthly series stops and nothing more is charged', (rm.status < 300 || rm2?.status < 300) && ch7.length === 0, { remove: rm.status, revoke: rm2?.status, err: (rm2 ?? rm).body?.error?.message, charged: ch7.map((c) => d(c.occurrenceDate)), stopped: sr7.stoppedReason, endDate: d(sr7.endDate), cancelAt: mem7b.cancelAt });

saveOut('monthly-out.json');
await done();
