// T5: a Guardian who also trains at the same School books her child (no GUARDIAN RoleGrant, as Decision 92 says Guardians hold none).
import { C, tk, call, S, short, db, checks, randomUUID, grant, tokenRca } from './lib.mjs';
const { ok, save } = checks('t5-parent-trains');
const D = C.branches.dubai;
const now = Date.now();
const mk = (k, first, last, years) => ({ id: randomUUID(), email: `r5-ae-t5-${k}-${now}@stress.test`, phone: `+97155${String(now).slice(-6)}${k}`, firstName: first, surname: last, passcodeHash: 'x', dateOfBirth: new Date(now - years * 365.25 * 86400e3), phoneVerifiedAt: new Date(), language: 'ar', currency: 'AED', gender: 'FEMALE' });
const mum = mk(1, 'عائشة', 'بنت علي (تتدرب)', 36), kid = mk(2, 'لطيفة', 'بنت عائشة', 8), mumOnly = mk(3, 'خديجة', 'لا تتدرب', 40), kid2 = mk(4, 'سلامة', 'بنت خديجة', 9);
await db.user.createMany({ data: [mum, kid, mumOnly, kid2] });
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: mum.id, role: 'STUDENT', schoolId: S, branchId: D },
  { id: randomUUID(), userId: kid.id, role: 'STUDENT', schoolId: S, branchId: D },
  { id: randomUUID(), userId: kid2.id, role: 'STUDENT', schoolId: S, branchId: D },
] });
await db.guardianLink.createMany({ data: [{ id: randomUUID(), guardianId: mum.id, studentId: kid.id }, { id: randomUUID(), guardianId: mumOnly.id, studentId: kid2.id }] });
await db.membership.createMany({ data: [kid, kid2].map((k) => ({ id: randomUUID(), studentId: k.id, schoolId: S, membershipPlanId: C.plans['اشتراك شهري غير محدود'], frequency: 'RECURRING' })) });
const cls = await db.class.findFirst({ where: { schoolId: S, branchId: D, cancelledAt: null, startDate: { gt: new Date(now + 86400e3) } }, orderBy: { startDate: 'asc' } });
// Tokens as sign-in builds them: grants from the DB.
const tMum = tokenRca(mum, [grant('STUDENT', S, D)]);
const tMumOnly = tokenRca(mumOnly, []);
const a = await call('t5:mum-who-trains-books-child', 'POST', `/classes/${cls.id}/book`, tMum, { studentId: kid.id });
const b = await call('t5:mum-not-member-books-child', 'POST', `/classes/${cls.id}/book`, tMumOnly, { studentId: kid2.id });
ok('T5a control: a Guardian who is not a member books her child', b.status === 201, `${b.status} ${short(b.body, 200)}`);
ok('T5b a Guardian who also trains at the School books her child', a.status === 201, `${a.status} ${short(a.body, 200)}`);
const c = await call('t5:mum-cancel', 'GET', `/guardians/me/minors/${kid.id}/bookings`, tMum);
ok('T5c INFO the training mother lists her child\'s bookings', true, `INFO ${c.status}`);
const w = await call('t5:mum-waitlist', 'POST', `/classes/${cls.id}/waitlist`, tMum, { studentId: kid.id });
ok('T5d INFO the training mother joins the waitlist for her child', true, `INFO ${w.status} ${short(w.body?.error?.message, 120)}`);
console.log(JSON.stringify({ mum: mum.id, kid: kid.id, cls: cls.id }));
save(); await db.$disconnect();
