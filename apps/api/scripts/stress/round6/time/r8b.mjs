// Round 6 T: R8 again on a clean School, sequential first (the rule), then at once, then confirmed.
import { call, must, db, signUp, signIn, burst, pool, ok, note, sectionOf } from './lib.mjs';
import { seedSchool } from './seed.mjs';
const tag = `r8${Date.now().toString(36)}`;
sectionOf('R8b member limit: cash orders one after another, then at once');
const s = await seedSchool(9, { members: 0, tag }); // BR CASH
const mk = async (k) => { const p = await signUp({ first: `Lim${k}`, last: 'Race', tag: `${tag}${k}` }); await must('join', 'POST', `/schools/${s.sid}/join`, p.tok, { branchId: s.branchId }); await signIn(p); return p; };
const plan = (t) => must('plan', 'POST', `/schools/${s.sid}/membership-plans`, s.owner.tok, { currency: s.cur, type: 'CLASS_PACK', title: t, price: 4000, classesIncluded: 4, expiryDurationDays: 30, memberLimit: 1 });
const ppl = await pool([0, 1, 2, 3, 4, 5], 3, mk);
const seqPlan = await plan('Seq limited');
const a = await call('POST', `/membership-plans/${seqPlan.id}/purchase`, ppl[0].tok, {});
const b = await call('POST', `/membership-plans/${seqPlan.id}/purchase`, ppl[1].tok, {});
ok('R8b: one after another, the second cash order is refused (pending counts, Decision 435 item 10)', a.status < 300 && b.status >= 400, { first: a.status, second: `${b.status} ${b.body?.error?.code ?? ''}` });
const racePlan = await plan('Race limited');
const rs = await burst(ppl.slice(2).map((p) => () => call('POST', `/membership-plans/${racePlan.id}/purchase`, p.tok, {})));
const won = rs.filter((r) => r.status < 300);
for (const r of won) await call('PATCH', `/transactions/${r.body.transactionId}/confirm`, s.owner.tok, {});
const active = await db.membership.count({ where: { membershipPlanId: racePlan.id, status: 'ACTIVE' } });
ok('R8b: four cash orders at once on a plan with 1 place: one accepted', won.length === 1, { results: rs.map((r) => r.status), activeAfterConfirming: active, memberLimit: 1 });
await db.$disconnect(); process.exit(0);
