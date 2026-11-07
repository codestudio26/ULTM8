// Round 5 US: waitlist and seat offers under races, claim windows and expiry.
//   CAST=../empty-cast.json node waitlist.mjs
import fs from 'fs';
import { db, call, grant, tokenRca, checks, codes } from '../../round4/common.mjs';
import { Queue, QueueEvents } from '../../round4/common.mjs';

const C = JSON.parse(fs.readFileSync(new URL('./cast-us.json', import.meta.url)));
const S = C.schoolId;
const { ok, save } = checks('waitlist');
const owner = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const ny = C.branches.find((b) => b.name === 'New York');
const instr = C.instructors.find((i) => i.branch === ny.id).id;
// Adults with the Unlimited plan at New York.
const adults = (await db.user.findMany({ where: { id: { in: C.students.filter((s, i) => s.branch === ny.id && i % 5 !== 1).map((s) => s.id) }, dateOfBirth: { lt: new Date(Date.now() - 19 * 365.25 * 86400e3) } }, select: { id: true, email: true } }));
let ai = 0;
const take = (n) => adults.slice(ai, (ai += n)).map((u) => ({ ...u, tok: tokenRca(u, [grant('STUDENT', S, ny.id)]) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runJob(name, jobName) {
  const q = new Queue(name, { connection: { url: process.env.REDIS_URL } });
  const ev = new QueueEvents(name, { connection: { url: process.env.REDIS_URL } });
  await ev.waitUntilReady();
  const job = await q.add(jobName, {});
  try { await job.waitUntilFinished(ev, 120e3); return true; } catch (e) { return e.message; } finally { await q.close(); await ev.close(); }
}
const mkClass = async (title, startOffMin, cap = 1) => {
  const r = await call('class', 'POST', `/schools/${S}/classes`, owner, { branchId: ny.id, instructorId: instr, title, styles: C.styles, startDate: new Date(Date.now() + startOffMin * 60e3).toISOString(), endDate: new Date(Date.now() + (startOffMin + 60) * 60e3).toISOString(), capacity: cap, membershipInclusion: true });
  if (r.status >= 300) throw new Error(JSON.stringify(r.body));
  return r.body;
};
const entries = (classId) => db.waitlistEntry.findMany({ where: { classId }, orderBy: { position: 'asc' } });
const seats = async (classId) => db.booking.count({ where: { classId, status: { in: ['UPCOMING', 'COMPLETED'] } } });
const waitNotified = async (classId, n = 1) => { for (let k = 0; k < 40; k++) { const e = await entries(classId); if (e.filter((x) => x.status === 'NOTIFIED').length >= n) return e; await sleep(250); } return entries(classId); };
const out = {};

// W1: capacity 1, 10 join the waitlist at once, the booker cancels.
const c1 = await mkClass('WL race 1', 26 * 60);
const [a] = take(1); const q10 = take(10);
const b1 = await call('book', 'POST', `/classes/${c1.id}/book`, a.tok, {});
const joins = await Promise.all(q10.map((s) => call('join', 'POST', `/classes/${c1.id}/waitlist`, s.tok, {})));
const e1 = await entries(c1.id);
ok('W1a 10 simultaneous joins: 10 entries, positions 1..10 unique', e1.length === 10 && new Set(e1.map((e) => e.position)).size === 10, `joins ${JSON.stringify(codes(joins))} positions ${e1.map((e) => e.position).join(',')}`);
const cx1 = await call('cancel', 'PATCH', `/bookings/${b1.body.id}/cancel`, a.tok, {}); console.log('book', b1.status, 'cancel', cx1.status, JSON.stringify(cx1.body).slice(0, 300));
const e1b = await waitNotified(c1.id);
const notified = e1b.filter((e) => e.status === 'NOTIFIED');
ok('W1b cancel notifies exactly the first in line', notified.length === 1 && notified[0].position === Math.min(...e1.map((e) => e.position)), `${notified.length} notified, deadline ${notified[0]?.claimByDeadline?.toISOString()}`);
// The direct booker can't take the held seat; the notified one double-clicks claim ×5.
const winner = q10.find((s) => s.id === notified[0]?.studentId);
const [walkIn] = take(1);
const race = await Promise.all([
  ...Array.from({ length: 5 }, () => call('claim', 'POST', `/waitlist/${notified[0].id}/claim`, winner.tok, {})),
  call('book', 'POST', `/classes/${c1.id}/book`, walkIn.tok, {}),
  call('book-staff', 'POST', `/classes/${c1.id}/book`, owner, { studentId: q10[9].id }),
]);
const n1 = await seats(c1.id);
out.w1race = race.map((r) => [r.status, r.body?.error?.message?.slice(0, 90)]);
ok('W1c claim ×5 + walk-in + staff booking at once: exactly 1 seat taken, by the notified one', n1 === 1 && (await db.booking.findFirst({ where: { classId: c1.id, status: 'UPCOMING' } }))?.studentId === winner.id, `${n1} seats; ${JSON.stringify(out.w1race)}`);
const pack = await db.membership.findMany({ where: { studentId: winner.id } });
out.winnerMembership = pack.map((m) => m.classesRemaining);

// W2: 10 notified for 1 seat (the cascade offered it again and again), all claim at once.
const c2 = await mkClass('WL race 2 (10 offers 1 seat)', 26 * 60);
const [hold] = take(1); const q2 = take(10);
const bh = await call('book', 'POST', `/classes/${c2.id}/book`, hold.tok, {});
await Promise.all(q2.map((s) => call('join', 'POST', `/classes/${c2.id}/waitlist`, s.tok, {})));
await call('cancel', 'PATCH', `/bookings/${bh.body.id}/cancel`, hold.tok, {});
await waitNotified(c2.id);
await db.waitlistEntry.updateMany({ where: { classId: c2.id, status: 'WAITING' }, data: { status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: new Date(Date.now() + 3600e3) } });
const e2 = await entries(c2.id);
const r2 = await Promise.all(e2.map((e) => call('claim', 'POST', `/waitlist/${e.id}/claim`, q2.find((s) => s.id === e.studentId).tok, {})));
const n2 = await seats(c2.id);
ok('W2a 10 notified claim 1 seat at once: exactly 1 wins, 9 get 409', n2 === 1 && r2.filter((r) => r.status === 201).length === 1, `${n2} seats; ${JSON.stringify(codes(r2))}`);
const leftover = await db.waitlistEntry.findMany({ where: { classId: c2.id } });
out.w2statuses = codes(leftover.map((e) => ({ status: e.status })));
const losersCredits = await db.membership.findMany({ where: { studentId: { in: q2.map((s) => s.id) }, classesRemaining: { not: null } }, select: { classesRemaining: true } });
ok('W2b losers keep their pack credits', losersCredits.every((m) => m.classesRemaining === 10), JSON.stringify(losersCredits.map((m) => m.classesRemaining)));

// W3: claim window expiry and the sweep job.
const c3 = await mkClass('WL expiry', 26 * 60);
const [h3] = take(1); const q3 = take(3);
const b3 = await call('book', 'POST', `/classes/${c3.id}/book`, h3.tok, {});
for (const s of q3) await call('join', 'POST', `/classes/${c3.id}/waitlist`, s.tok, {});
await call('cancel', 'PATCH', `/bookings/${b3.body.id}/cancel`, h3.tok, {});
const e3 = (await waitNotified(c3.id)).find((e) => e.status === 'NOTIFIED');
await db.waitlistEntry.update({ where: { id: e3.id }, data: { claimByDeadline: new Date(Date.now() - 1000) } });
const late = await call('claim', 'POST', `/waitlist/${e3.id}/claim`, q3.find((s) => s.id === e3.studentId).tok, {});
ok('W3a claim after the window: 409', late.status === 409, `${late.status} ${late.body?.error?.message}`);
const jr = await runJob('waitlist-cascade-processing', 'sweep-expired');
const e3b = await waitNotified(c3.id);
ok('W3b sweep expires it and offers the seat to the next', jr === true && e3b.find((e) => e.id === e3.id).status === 'EXPIRED' && e3b.filter((e) => e.status === 'NOTIFIED').length === 1, JSON.stringify(e3b.map((e) => e.position + ':' + e.status)));

// W4: a class starting in 30 min: the 60-min window is cut at the start.
const c4 = await mkClass('WL soon', 30);
const [h4] = take(1); const [w4] = take(1);
const b4 = await call('book', 'POST', `/classes/${c4.id}/book`, h4.tok, {});
await call('join', 'POST', `/classes/${c4.id}/waitlist`, w4.tok, {});
await call('cancel', 'PATCH', `/bookings/${b4.body.id}/cancel`, h4.tok, {});
const e4 = (await waitNotified(c4.id))[0];
const cls4 = await db.class.findUnique({ where: { id: c4.id } });
ok('W4a claim deadline capped at the class start', e4.claimByDeadline?.getTime() === cls4.startDate.getTime(), `${e4.claimByDeadline?.toISOString()} vs ${cls4.startDate.toISOString()}`);

fs.writeFileSync(new URL('./waitlist-out.json', import.meta.url), JSON.stringify(out, null, 1));
save();
await db.$disconnect();
process.exit(0);
