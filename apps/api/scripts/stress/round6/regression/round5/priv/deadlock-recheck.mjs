// NG-1 repro: a phone re-sends "Book" while it also re-sends "Cancel" (flaky
// network, the member tapped Book, then Cancel, and both were retried).
// TRIALS (default 8) students, each: book once, then 5 book + 5 cancel at once.
import fs from 'fs';
import { db, call, codes } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('../ng/ng-cast.json', import.meta.url)));
const TRIALS = Number(process.env.TRIALS || 8);
const studs = c.students.filter((s, i) => i >= Number(process.env.OFF || 340) && s.kind === 'pack10' && s.branch === c.branches.island).slice(0, TRIALS);
const cls = c.classes.future[Number(process.env.CI_ || 9)];
let five = 0;
for (const s of studs) {
  const first = await call('d:book', 'POST', `/classes/${cls}/book`, s.tok, {});
  if (first.status !== 201) { console.log('first book', first.status, JSON.stringify(first.body)); continue; }
  const rs = await Promise.all([
    ...Array.from({ length: 5 }, () => call('d:book', 'POST', `/classes/${cls}/book`, s.tok, {}).then((r) => ({ ...r, op: 'book' }))),
    ...Array.from({ length: 5 }, () => call('d:cancel', 'PATCH', `/bookings/${first.body.id}/cancel`, s.tok, {}).then((r) => ({ ...r, op: 'cancel' }))),
  ]);
  const bad = rs.filter((r) => r.status >= 500);
  five += bad.length;
  const bk = await db.booking.findMany({ where: { studentId: s.id, classId: cls }, select: { status: true } });
  const m = await db.membership.findFirst({ where: { studentId: s.id, schoolId: c.schoolId, membershipPlanId: c.plans.pack10 }, select: { classesRemaining: true } });
  const live = bk.filter((b) => b.status === 'UPCOMING').length;
  console.log(new Date().toISOString(), s.id.slice(0, 8), JSON.stringify(codes(rs)), '500s:', bad.map((r) => `${r.op} ${JSON.stringify(r.body)}`).join(' | '), `bookings ${JSON.stringify(bk.map((b) => b.status))} credits ${m.classesRemaining} ${m.classesRemaining === 10 - live ? 'consistent' : 'INCONSISTENT'}`);
}
console.log('total 500s', five, 'over', studs.length, 'trials');
await db.$disconnect();
