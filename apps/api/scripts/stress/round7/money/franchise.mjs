// Round 7, D check 2: the Franchise owner's overview (#534, Decision 450
// item 1) against each member School owner's own reports, on the populated
// demo (origin/demo/populated-demo apps/api/scripts/demo/seed-demo.mjs: four
// Schools, GBP/GBP/EUR/BRL, London/London/Dublin/São Paulo, ~1,165 members,
// 13 weeks of history). Per School: students (Growth), attendance (Attendance
// statistics), new/cancelled per month (Growth), revenue per currency per
// month (the billing overview). Totals per currency, never summed across
// currencies. Then the Franchise's fee charges, newest first, paged. Last, one
// School leaves the Franchise and drops out.  LEAVE=0 skips the leaving.
import { call, db, rec, expect, saveOut, signIn } from './lib.mjs';

const A = 'franchise';
const FRANCHISE_ID = 'de300000-0000-4000-8000-000000000001';
const PASS = process.env.DEMO_PASSCODE || '123456';
const founder = { email: 'founder@apex-demo.example', passcode: PASS };
await signIn(founder);
const schools = await db.school.findMany({ where: { franchiseId: FRANCHISE_ID }, select: { id: true, name: true, timezone: true, defaultCurrency: true } });
const owners = {};
for (const s of schools) {
  const g = await db.roleGrant.findFirst({ where: { schoolId: s.id, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, orderBy: { createdAt: 'asc' } });
  const u = await db.user.findUnique({ where: { id: g.userId } });
  owners[s.id] = { email: u.email, passcode: PASS };
  await signIn(owners[s.id]);
}
const t0 = Date.now();
const ov = await call('GET', `/franchises/${FRANCHISE_ID}/overview`, founder.tok);
rec(A, 'setup', 'NOTE', { schools: schools.map((s) => `${s.name} ${s.defaultCurrency} ${s.timezone}`), overview: ov.status, ms: Date.now() - t0 });

async function compareAll(label, ovBody) {
  for (const s of ovBody.schools) {
    const o = owners[s.schoolId];
    if (!o) { rec(A, `${label} ${s.name}`, 'FAIL', 'a School not in the Franchise is listed'); continue; }
    const [g, st, bo] = await Promise.all([
      call('GET', `/schools/${s.schoolId}/growth`, o.tok),
      call('GET', `/schools/${s.schoolId}/attendance/stats`, o.tok),
      call('GET', `/schools/${s.schoolId}/charge-reports/overview`, o.tok),
    ]);
    const enrolled = await db.roleGrant.findMany({ where: { schoolId: s.schoolId, role: 'STUDENT', revokedAt: null }, distinct: ['userId'], select: { userId: true } });
    expect(A, `${label} ${s.name}: students (active = Growth's; enrolled = active STUDENT grants)`, s.activeStudents === g.body.activeStudents && s.enrolledStudents === enrolled.length, { franchise: { active: s.activeStudents, enrolled: s.enrolledStudents }, growth: g.body.activeStudents, enrolled: enrolled.length });
    const statsCheckIns = st.body.checkIns + (st.body.guestCheckIns ?? 0);
    expect(A, `${label} ${s.name}: check-ins last 30 days = Attendance statistics (members + guests)`, s.checkInsLast30Days === statsCheckIns, { franchise: s.checkInsLast30Days, stats: { checkIns: st.body.checkIns, guest: st.body.guestCheckIns, logged: st.body.loggedCheckIns, excludePasses: st.body.excludePasses, from: st.body.from, to: st.body.to } });
    const gm = new Map(g.body.months.map((m) => [m.month, m]));
    const mBad = s.months.filter((m) => { const x = gm.get(m.month); return !x || x.newStudents !== m.newStudents || x.cancelled !== m.cancelled; });
    expect(A, `${label} ${s.name}: new and cancelled per month = Growth's months`, mBad.length === 0 && s.months.length === g.body.months.length, { bad: mBad.slice(0, 3).map((m) => ({ f: m, g: gm.get(m.month) })), months: [s.months[0]?.month, s.months.at(-1)?.month], growth: [g.body.months[0]?.month, g.body.months.at(-1)?.month] });
    // Revenue per currency per month vs the billing overview.
    const rBad = [];
    for (const bc of bo.body.currencies) {
      const fc = s.revenue.find((r) => r.currency === bc.currency);
      if (!fc) { if (bc.total || bc.paid) rBad.push({ missingCurrency: bc.currency }); continue; }
      for (const bm of bc.revenueByMonth) {
        const fm = fc.byMonth.find((m) => m.month === bm.month) ?? { memberships: 0, charges: 0, fees: 0, surcharges: 0, total: 0 };
        if (fm.memberships !== bm.memberships || fm.charges !== bm.net || fm.fees !== bm.fees || fm.surcharges !== bm.surcharges || fm.total !== bm.total) rBad.push({ cur: bc.currency, month: bm.month, franchise: fm, billing: { memberships: bm.memberships, net: bm.net, fees: bm.fees, surcharges: bm.surcharges, total: bm.total } });
      }
      if (fc.total !== bc.total || fc.memberships !== bc.memberships || fc.fees !== bc.fees || fc.surcharges !== bc.surcharges || fc.charges !== bc.paid) rBad.push({ cur: bc.currency, headline: { franchise: { mem: fc.memberships, ch: fc.charges, fees: fc.fees, sur: fc.surcharges, total: fc.total }, billing: { mem: bc.memberships, paid: bc.paid, fees: bc.fees, sur: bc.surcharges, total: bc.total } } });
    }
    for (const fc of s.revenue) if (!bo.body.currencies.find((c) => c.currency === fc.currency) && fc.total) rBad.push({ extraCurrency: fc.currency, total: fc.total });
    expect(A, `${label} ${s.name}: revenue per currency per month (memberships, charges, fees, surcharges, total) = the School's billing overview`, rBad.length === 0, { bad: rBad.slice(0, 4), currencies: s.revenue.map((r) => `${r.currency} ${r.total}`) });
  }
  // Totals: added up per currency only.
  const t = ovBody.totals;
  const want = {};
  for (const s of ovBody.schools) for (const r of s.revenue) { const w = (want[r.currency] ||= { total: 0, memberships: 0, fees: 0 }); w.total += r.total; w.memberships += r.memberships; w.fees += r.fees; }
  const tRev = t.revenue ?? [];
  const tBad = Object.entries(want).filter(([c, w]) => { const x = tRev.find((r) => r.currency === c); return !x || x.total !== w.total || x.memberships !== w.memberships || x.fees !== w.fees; });
  const sumStudents = ovBody.schools.reduce((n, s) => n + s.activeStudents, 0);
  expect(A, `${label} Franchise totals: one line per currency (never summed together), each the sum of its Schools; students summed`, tBad.length === 0 && tRev.length === Object.keys(want).length && t.activeStudents === sumStudents, { totalsKeys: Object.keys(t), revenue: tRev.map((r) => `${r.currency} ${r.total}`), want, students: { totals: t.activeStudents, sum: sumStudents }, bad: tBad });
}

if (ov.status === 200) await compareAll('O1', ov.body);
else rec(A, 'O1 overview', 'FAIL', { status: ov.status, body: ov.body });

// Fee charges, newest first, paged without skips or repeats.
{
  const all = await db.franchiseFeeCharge.findMany({ where: { franchiseId: FRANCHISE_ID } });
  const want = all.sort((a, b) => b.billingPeriodStart - a.billingPeriodStart || (a.id < b.id ? 1 : -1)).map((c) => c.id);
  const seen = []; let cursor = null, pages = 0;
  do {
    const r = await call('GET', `/franchises/${FRANCHISE_ID}/fee-charges?limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, founder.tok);
    if (r.status !== 200) { rec(A, 'F1 fee charges', 'FAIL', { status: r.status, body: r.body }); break; }
    seen.push(...r.body.items.map((x) => x.id)); cursor = r.body.nextCursor; pages++;
  } while (cursor && pages < 100);
  expect(A, 'F1 Franchise fee charges: newest billing period first, pages of 4 never skip or repeat', seen.join() === want.join(), { got: seen.length, want: want.length, pages, dupes: seen.length - new Set(seen).size });
}

// A School leaves the Franchise: it drops out of the overview and the totals.
if (process.env.LEAVE !== '0' && ov.status === 200) {
  const leaver = ov.body.schools.find((s) => s.revenue.some((r) => r.currency === 'EUR')) ?? ov.body.schools.at(-1);
  const l = await call('POST', `/schools/${leaver.schoolId}/leave-franchise`, owners[leaver.schoolId].tok, {});
  const ov2 = await call('GET', `/franchises/${FRANCHISE_ID}/overview`, founder.tok);
  const still = ov2.body?.schools?.some((s) => s.schoolId === leaver.schoolId);
  expect(A, `L1 ${leaver.name} leaves the Franchise: no longer in the overview; its currency gone from the totals if it was the only one`, l.status < 300 && ov2.status === 200 && !still && ov2.body.schools.length === ov.body.schools.length - 1, { leave: l.status, err: l.body?.error?.message, still, schools: ov2.body?.schools?.length, totals: ov2.body?.totals?.revenue?.map((r) => r.currency) });
  if (ov2.status === 200) await compareAll('L2 after leaving:', ov2.body);
  const asSchool = await call('GET', `/franchises/${FRANCHISE_ID}/overview`, owners[leaver.schoolId].tok);
  rec(A, 'L3 the leaver\'s owner asks for the Franchise overview', [403, 404].includes(asSchool.status) ? 'PASS' : 'FAIL', { status: asSchool.status, code: asSchool.body?.error?.code });
}
saveOut('franchise-out.json');
await db.$disconnect();
process.exit(0);
