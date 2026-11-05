// T4: Guardians/minors, notices to the right parent, turning 18, cross-School privacy, student-app endpoints, input abuse.
import { C, tk, call, S, short, db, checks, codes, grant, tokenRca } from './lib.mjs';
const { ok, save } = checks('t4-people');
const D = C.branches.dubai, A = C.branches.abu;
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const items = (b) => (Array.isArray(b) ? b : b?.items ?? []);
// Divorced parents: both see Hamdan; mother of siblings sees neither Hamdan.
const kidId = C.sp.kidDivorced.id;
const dad = await call('t4:dad-minors', 'GET', '/guardians/me/minors', tk(C.gDad, 'GUARDIAN'));
const mum2 = await call('t4:mum-minors', 'GET', '/guardians/me/minors', tk(C.gMum2, 'GUARDIAN'));
const other = await call('t4:other-minor', 'GET', `/guardians/me/minors/${kidId}/bookings`, tk(C.gMother, 'GUARDIAN'));
const has = (r) => JSON.stringify(r.body).includes(kidId);
ok('T4a both divorced parents see Hamdan; another Guardian is refused', dad.status === 200 && has(dad) && has(mum2) && other.status >= 400, `${dad.status}/${mum2.status} other=${other.status}`);
// Guardian books child; both parents get the child's notice? Book via guardian.
const cls = await db.class.findFirst({ where: { schoolId: S, branchId: D, startDate: { gt: new Date() }, cancelledAt: null }, orderBy: { startDate: 'asc' } });
const gb = await call('t4:guardian-book', 'POST', `/classes/${cls.id}/book`, tk(C.gDad, 'GUARDIAN'), { studentId: kidId });
ok('T4b Guardian books the child', gb.status === 201, `${gb.status} ${short(gb.body, 160)}`);
await call('t4:cancel-class', 'POST', `/classes/${cls.id}/cancel`, tOwner, { reason: 'صيانة الصالة' });
await new Promise((r) => setTimeout(r, 5000));
const nn = async (u) => (await db.notification.findMany({ where: { userId: u.id, createdAt: { gt: new Date(Date.now() - 60e3) } }, select: { title: true, body: true } }));
const [nDad, nMum2, nMother, nKid] = await Promise.all([nn(C.gDad), nn(C.gMum2), nn(C.gMother), nn(C.sp.kidDivorced)]);
const about = (l) => l.some((x) => x.body.includes('صيانة الصالة') && x.body.includes(cls.title));
ok('T4c class cancelled: both divorced parents get the child\'s notice, the other Guardian does not', about(nDad) && about(nMum2) && !about(nMother), `dad=${about(nDad)} mum2=${about(nMum2)} otherGuardian=${about(nMother)} kid=${about(nKid)}; sample=${short(nDad[0], 200)}`);
// Turning 18 in 3 days: can she sign waiver herself now? Turned 18 yesterday: must sign herself, guardian can't.
const t18 = await call('t4:turning18-sign-self', 'POST', `/waivers/${C.waiver}/sign`, tk(C.sp.turning18, 'STUDENT', D), { signerFullName: 'نورة بنت راشد', signatureText: 'نورة' });
ok('T4d minor (18 in 3 days) cannot sign herself', t18.status >= 400, `${t18.status} ${short(t18.body?.error?.message, 160)}`);
const t18g = await call('t4:turning18-guardian', 'POST', `/waivers/${C.waiver}/sign`, tk(C.gDad, 'GUARDIAN'), { studentId: C.sp.turning18.id, signerFullName: 'Rashid Al-Mansouri', signatureText: 'Rashid' });
ok('T4e Guardian signs for minor turning 18 in 3 days', t18g.status === 201, `${t18g.status} ${short(t18g.body?.error?.message, 160)}`);
const done18 = await call('t4:turned18-self', 'POST', `/waivers/${C.waiver}/sign`, tk(C.sp.turned18, 'STUDENT', D), { signerFullName: 'خالد بن سيف', signatureText: 'خالد' });
ok('T4f student who turned 18 yesterday signs herself', done18.status === 201, `${done18.status} ${short(done18.body?.error?.message, 160)}`);
// 29 Feb birthday: age computed? Layla born 2008-02-29 → 18 on 2026-03-01 (or 02-28). She is 18 now.
const leap = await call('t4:leap-sign', 'POST', `/waivers/${C.waiver}/sign`, tk(C.sp.leap, 'STUDENT', D), { signerFullName: 'Layla Feb29', signatureText: 'Layla' });
ok('T4g 29-Feb-2008 member (18 now) signs herself', leap.status === 201, `${leap.status} ${short(leap.body?.error?.message, 160)}`);
// 95-year-old and toddler books
const tod = await call('t4:toddler-book', 'POST', `/classes/${(await db.class.findFirst({ where: { schoolId: S, branchId: D, cancelledAt: null, startDate: { gt: new Date() } }, orderBy: { startDate: 'asc' } })).id}/book`, tk(C.owner, 'GUARDIAN'), { studentId: C.sp.toddler.id });
ok('T4h owner as Guardian books her 3-year-old', true, `INFO ${tod.status} ${short(tod.body?.error?.message ?? tod.body?.status, 160)}`);
// Cross-School privacy: my owner reads other testers' Schools; their ids from DB.
const others = await db.school.findMany({ where: { name: { startsWith: 'R5 ' }, NOT: { name: { startsWith: 'R5 AE' } } }, select: { id: true, name: true }, take: 6 });
const xt = [];
for (const o of others) {
  for (const p of [`/schools/${o.id}`, `/schools/${o.id}/students`, `/schools/${o.id}/students/export`, `/schools/${o.id}/waivers`, `/schools/${o.id}/staff`, `/schools/${o.id}/closures`, `/schools/${o.id}/timetable`, `/schools/${o.id}/charge-reports/summary`])
    xt.push(await call('t4:xt', 'GET', p, tOwner).then((r) => ({ p, ...r })));
  xt.push(await call('t4:xt-bc', 'POST', `/schools/${o.id}/notifications/broadcast`, tOwner, { title: 'x', body: 'x', audience: 'ALL' }).then((r) => ({ p: 'broadcast', ...r })));
  xt.push(await call('t4:xt-cl', 'POST', `/schools/${o.id}/closures`, tOwner, { startDate: '2027-01-01', endDate: '2027-01-01', reason: 'x' }).then((r) => ({ p: 'closure', ...r })));
}
const leaks = xt.filter((r) => r.status < 300 && !(r.p.endsWith(`/schools/${r.p.split('/')[2]}`)));
const pub = xt.filter((r) => r.status < 300);
ok('T4i cross-School: other testers\' Schools refuse my owner (reads and writes)', leaks.length === 0, `${xt.length} tries ${JSON.stringify(codes(xt))}; 2xx on: ${pub.map((r) => r.p.replace(/[0-9a-f-]{36}/, '…')).slice(0, 6).join(', ')}`);
const theirClasses = await db.class.findMany({ where: { schoolId: { in: others.map((o) => o.id) }, startDate: { gt: new Date() }, cancelledAt: null }, take: 3, select: { id: true } });
const xb = await Promise.all(theirClasses.map((c) => call('t4:xt-book', 'POST', `/classes/${c.id}/book`, tk(C.sp.bidi, 'STUDENT', D), {})));
const xr = await Promise.all(theirClasses.map((c) => call('t4:xt-roster', 'GET', `/classes/${c.id}/bookings`, tOwner)));
ok('T4j cross-School: my member can\'t book their classes, my owner can\'t read their rosters', [...xb, ...xr].every((r) => r.status >= 400), `${JSON.stringify(codes(xb))} ${JSON.stringify(codes(xr))}`);
// Input abuse on names (profile patch by owner): 5000 chars, null byte, RLO override, SQL-ish.
const tries = [['5000', 'ف'.repeat(5000)], ['nul', 'فاطمة\u0000'], ['rlo', '‮أحمد‬ evil.exe'], ['sql', "'; DROP TABLE \"User\";--"], ['empty', '   '], ['tatweel', 'فـــــاطمة']];
const pr = [];
for (const [k, v] of tries) pr.push([k, await call('t4:abuse-' + k, 'PATCH', `/schools/${S}/students/${C.sp.emoji.id}/profile`, tOwner, { firstName: v })]);
ok('T4k INFO profile name abuse', true, pr.map(([k, r]) => `${k}:${r.status}${r.status >= 300 ? '(' + short(r.body?.error?.message, 60) + ')' : ''}`).join(' | '));
const u = await db.user.findUnique({ where: { id: C.sp.emoji.id }, select: { firstName: true } });
ok('T4l INFO name stored after abuse', true, short(u.firstName, 80));
await call('t4:restore-name', 'PATCH', `/schools/${S}/students/${C.sp.emoji.id}/profile`, tOwner, { firstName: 'نورة 🥊' });
// Double-click 10 bookings at once for one student
const cap = await db.class.findFirst({ where: { schoolId: S, branchId: A, cancelledAt: null, startDate: { gt: new Date() } }, orderBy: { startDate: 'desc' } });
const aStu = C.students.find((s) => s.branch === A && !Object.values(C.sp).some((x) => x.id === s.id));
const ten = await Promise.all(Array.from({ length: 10 }, () => call('t4:book-x10', 'POST', `/classes/${cap.id}/book`, tk(aStu, 'STUDENT', A), {})));
const nb = await db.booking.count({ where: { classId: cap.id, studentId: aStu.id, status: { not: 'CANCELLED' } } });
ok('T4m booking clicked 10 times at once → one booking', nb === 1, `${JSON.stringify(codes(ten))} bookings=${nb}`);
save(); await db.$disconnect();
