// Phase 2: every student declares a belt, books classes, is checked in and graded.
// Then checks the database against what should have happened.
import fs from 'fs';
import { db, call, pool, report, stats } from './lib.mjs';

const cast = JSON.parse(fs.readFileSync(new URL('./cast.json', import.meta.url)));
const C = Number(process.env.CONC || 64);
const findings = [];
const note = (f) => { findings.push(f); console.log('FINDING:', f); };
const t = () => performance.now();

// First rung of each style, and the timetable Classes per school.
for (const s of cast.schools) {
  const first = await db.rank.findFirst({ where: { disciplineId: s.disciplineId, archivedAt: null }, orderBy: { order: 'asc' }, include: { stripeTiers: { orderBy: { order: 'asc' }, take: 1 } } });
  s.firstRank = first.id; s.firstTier = first.stripeTiers[0].id;
  s.ttClasses = (await db.class.findMany({ where: { schoolId: s.id, timetableSlotId: { not: null }, startDate: { gt: new Date() } }, select: { id: true }, orderBy: { startDate: 'asc' } })).map((c) => c.id);
}
const all = cast.schools.flatMap((s) => s.students.map((st, i) => ({ s, st, i })));

// 1. Declare the first belt (self-service).
let t0 = t();
await pool(all, C, ({ s, st }) => call('declare', 'POST', `/students/${st.id}/ranks/${s.disciplineId}/declare`, st.tok, { rankId: s.firstRank, stripeTierId: s.firstTier }));
console.log(`declare: ${all.length} in ${((t() - t0) / 1000).toFixed(1)}s`);

// 2. Bookings: one class running now + two future timetable classes each.
t0 = t();
const bookingRes = await pool(all, C, async ({ s, st, i }) => {
  const nowCls = i % 13 === 12 ? s.open : s.nowClasses[i % 12];
  const a = await call('book:now', 'POST', `/classes/${nowCls}/book`, st.tok, {});
  const f1 = await call('book:timetable', 'POST', `/classes/${s.ttClasses[i % s.ttClasses.length]}/book`, st.tok, {});
  const f2 = await call('book:timetable', 'POST', `/classes/${s.ttClasses[(i * 7 + 3) % s.ttClasses.length]}/book`, st.tok, {});
  return { kind: st.kind, now: a.status, f1: f1.status, f2: f2.status, nowCls, body: a.status >= 300 ? a.body : null };
});
console.log(`bookings: ${all.length * 3} in ${((t() - t0) / 1000).toFixed(1)}s`);
const byKind = {};
for (const r of bookingRes) { const k = (byKind[r.kind] ||= {}); k[r.now] = (k[r.now] || 0) + 1; }
console.log('book:now result by membership kind', byKind);
if ((byKind.expired?.[201] || 0) > 0) note(`Booking accepted ${byKind.expired[201]} times on an ACTIVE membership whose expiryDate had already passed (sweep not yet run)`);
// Class pack: 3 bookings each should leave 2 credits.
const packLeft = await db.membership.groupBy({ by: ['classesRemaining'], where: { classesRemaining: { not: null } }, _count: true });
console.log('class pack credits left after 3 bookings each:', packLeft.map((g) => `${g.classesRemaining}:${g._count}`).join(' '));

// 3. Capacity races: 30 students at Tiny A (cap 10), 20 at Tiny B (cap 3), all at once, per school.
t0 = t();
let over = 0;
await pool(cast.schools, 10, async (s) => {
  const subs = s.students.filter((x) => x.kind === 'sub' && x.branch === s.branches[0]);
  await Promise.all([
    ...subs.slice(0, 30).map((st) => call('race:tiny', 'POST', `/classes/${s.tiny[0]}/book`, st.tok, {})),
    ...subs.slice(30, 50).map((st) => call('race:tiny', 'POST', `/classes/${s.tiny[1]}/book`, st.tok, {})),
  ]);
  const [a, b] = await Promise.all(s.tiny.map((id) => db.booking.count({ where: { classId: id, status: 'UPCOMING' } })));
  if (a !== 10 || b !== 3) { over++; note(`Capacity broken in ${s.id}: Tiny A ${a}/10, Tiny B ${b}/3`); }
});
console.log(`capacity races: ${cast.schools.length * 2} classes, ${over} over/under in ${((t() - t0) / 1000).toFixed(1)}s`);

// 4. Gate probes: booking-closed, ended, next week (fine), archived.
const probe = {};
await pool(cast.schools, 10, async (s) => {
  const st = s.students.find((x) => x.kind === 'sub' && x.branch === s.branches[0]);
  for (const [name, id] of [['bookingEndAt passed', s.closed], ['class ended yesterday', s.ended], ['next week', s.future]]) {
    const r = await call('probe', 'POST', `/classes/${id}/book`, st.tok, {});
    (probe[name] ||= {})[r.status] = (probe[name][r.status] || 0) + 1;
  }
});
// Staff walk-in after the booking cut-off (allowed until the class ends).
await pool(cast.schools, 10, async (s) => {
  const st = s.students.filter((x) => x.kind === 'sub' && x.branch === s.branches[0])[1];
  const r = await call('probe:staff-after-cutoff', 'POST', `/classes/${s.closed}/book`, s.staff.tok, { studentId: st.id });
  (probe['staff walk-in after cut-off'] ||= {})[r.status] = (probe['staff walk-in after cut-off'][r.status] || 0) + 1;
});
console.log('gate probes', probe);
if (probe['bookingEndAt passed']?.[201]) note(`Booking accepted after the Class's bookingEndAt (${probe['bookingEndAt passed'][201]}/${cast.schools.length})`);
if (probe['class ended yesterday']?.[201]) note(`Booking accepted for a Class that ended yesterday (${probe['class ended yesterday'][201]}/${cast.schools.length})`);

// 5. Check-in: instructor roll call for everyone booked into a class running now.
const toCheck = await db.booking.findMany({ where: { status: 'UPCOMING', classId: { in: cast.schools.flatMap((s) => [...s.nowClasses, s.open, ...s.tiny]) } }, select: { studentId: true, classId: true, schoolId: true } });
const instrBy = Object.fromEntries(cast.schools.map((s) => [s.id, s.instructor.tok]));
t0 = t();
await pool(toCheck, C, (b) => call('checkin:instructor', 'POST', `/classes/${b.classId}/attendance-scan`, instrBy[b.schoolId], { studentId: b.studentId }));
console.log(`check-ins: ${toCheck.length} in ${((t() - t0) / 1000).toFixed(1)}s`);
// Early check-in probe: check a student into next week's timetable class now.
let early = 0;
await pool(cast.schools, 10, async (s) => {
  const b = await db.booking.findFirst({ where: { schoolId: s.id, status: 'UPCOMING', class: { startDate: { gt: new Date(Date.now() + 86400e3) } } }, select: { studentId: true, classId: true } });
  if (!b) return;
  const r = await call('probe:early-checkin', 'POST', `/classes/${b.classId}/attendance-scan`, s.instructor.tok, { studentId: b.studentId });
  if (r.status < 300) early++;
});
if (early) note(`Check-in accepted for classes that start more than a day later (${early}/${cast.schools.length}); the attendance counts toward grading`);

// 6. Grading: owner promotes every student one rung; board load per school.
t0 = t();
const promo = await pool(all, C, async ({ s, st }) => ({ kind: st.kind, r: await call('grade:promote', 'POST', `/students/${st.id}/ranks/${s.disciplineId}/promote`, s.owner.tok, { acknowledgeWithoutSkillSignoff: true }) }));
console.log(`promotions: ${all.length} in ${((t() - t0) / 1000).toFixed(1)}s`);
const pk = {};
for (const p of promo) { const k = (pk[p.kind] ||= {}); k[p.r.status] = (k[p.r.status] || 0) + 1; }
console.log('promote result by membership kind', pk);
if (pk.expired?.[201] || pk.expired?.[200]) note(`Promotion accepted for students whose membership had expired (${(pk.expired[201] || 0) + (pk.expired[200] || 0)})`);
const sample = promo.find((p) => p.r.status >= 400 && p.kind === 'sub');
if (sample) console.log('sample promote failure for a live member:', JSON.stringify(sample.r.body).slice(0, 300));
t0 = t();
await pool(cast.schools, 10, (s) => call('grade:board', 'GET', `/schools/${s.id}/grading-board?disciplineId=${s.disciplineId}`, s.owner.tok));
await pool(cast.schools, 10, (s) => call('bookings:summary', 'GET', `/schools/${s.id}/bookings/summary`, s.owner.tok));
console.log(`boards + summaries in ${((t() - t0) / 1000).toFixed(1)}s`);

// 7. Consistency checks in the database.
const dupe = await db.$queryRaw`SELECT "studentId","classId",count(*)::int n FROM "Booking" WHERE status='UPCOMING' GROUP BY 1,2 HAVING count(*)>1`;
if (dupe.length) note(`${dupe.length} duplicate upcoming bookings`);
const neg = await db.membership.count({ where: { classesRemaining: { lt: 0 } } });
if (neg) note(`${neg} memberships with negative credits`);
const overCap = await db.$queryRaw`SELECT c.id, c.capacity, count(b.id)::int n FROM "Class" c JOIN "Booking" b ON b."classId"=c.id AND b.status IN ('UPCOMING','COMPLETED') WHERE c.capacity IS NOT NULL GROUP BY 1,2 HAVING count(b.id) > c.capacity`;
if (overCap.length) note(`${overCap.length} classes over capacity`);
const crossTenant = await db.$queryRaw`SELECT count(*)::int n FROM "Booking" b JOIN "Class" c ON c.id=b."classId" WHERE b."schoolId" <> c."schoolId"`;
if (crossTenant[0].n) note(`${crossTenant[0].n} bookings whose schoolId differs from their class`);

report();
fs.writeFileSync(new URL('./load-result.json', import.meta.url), JSON.stringify({ findings, stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { n: v.n, codes: v.codes }])) }, null, 1));
await db.$disconnect();
