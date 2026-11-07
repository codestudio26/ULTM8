// Round 4, phase 2: a busy day of normal School life across all 500 Schools at
// once, then every background job, then the owner's everyday pages at every
// School size. Correctness checks at the end (seats, credits, money, signatures,
// notifications). Writes life-result.json and life-latency.json.
//   C  requests in flight (default 64)
import { db, call, pool, cast, report, checks, live, Queue, QueueEvents, bySize, stats } from './common.mjs';

const C = Number(process.env.C || 64);
// Per-student steps (booking, signing, desk sales) run for this share of the
// students: one API instance books about 25-40 a second, so all 126,000 would take
// well over an hour. Every School still takes part; the per-School steps run in full.
const SAMPLE = Number(process.env.SAMPLE || 0.2);
const sampled = (i) => (i * 7919) % 1000 < SAMPLE * 1000;
const { ok, save } = checks('life');
const t0 = Date.now();
const lap = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const everyone = cast.schools.flatMap((s) => s.students.map((st) => ({ s, st })));
const all = everyone.filter((_, i) => sampled(i));
lap(`${cast.schools.length} Schools, ${everyone.length} students, ${all.length} in the per-student steps`);

// Upcoming generated classes per Branch (next 7 days), from the database.
const week = await db.class.findMany({ where: { schoolId: { in: cast.schools.map((s) => s.id) }, timetableSlotId: { not: null }, startDate: { gt: new Date(Date.now() + 2 * 3600e3), lt: new Date(Date.now() + 7 * 86400e3) }, archivedAt: null, cancelledAt: null }, select: { id: true, branchId: true } });
const byBranch = new Map();
for (const c of week) (byBranch.get(c.branchId) ?? byBranch.set(c.branchId, []).get(c.branchId)).push(c.id);
lap(`${week.length} upcoming timetable classes`);

// 1. Booking peak: every student books one class this week at their Branch; a
//    third book a second one.
const booked = [];
await pool(all, C, async ({ s, st }, i) => {
  const list = byBranch.get(st.branch); if (!list?.length) return;
  for (const k of i % 3 === 0 ? [i, i * 7 + 3] : [i]) {
    const cls = list[k % list.length];
    const r = await call('book:peak', 'POST', `/classes/${cls}/book`, st.tok, {});
    if (r.status === 201) booked.push({ s, st, id: r.body.id, cls });
  }
});
lap(`booking peak: ${booked.length} booked`);

// 2. One in ten cancels again.
const cancelled = booked.filter((_, i) => i % 10 === 0);
await pool(cancelled, C, ({ st, id }) => call('book:cancel', 'PATCH', `/bookings/${id}/cancel`, st.tok, {}));
lap('cancellations done');

// 3. 18:00 front-desk rush: students book the class running now, the coach checks them in.
const rush = [];
for (const s of cast.schools) {
  const subs = s.students.filter((st) => st.kind === 'sub' && st.branch === s.branches[0]);
  s.nowClasses.forEach((cls, k) => subs.slice(k * 10, k * 10 + 10).forEach((st) => rush.push({ s, st, cls })));
}
const nowBooked = [];
await pool(rush, C, async ({ s, st, cls }) => { const r = await call('rush:book-now', 'POST', `/classes/${cls}/book`, st.tok, {}); if (r.status === 201) nowBooked.push({ s, st, cls }); });
await pool(nowBooked, C, ({ s, st, cls }) => call('rush:check-in', 'POST', `/classes/${cls}/attendance-scan`, s.instructor.tok, { studentId: st.id }));
lap(`rush: ${nowBooked.length} booked now and checked in`);

// 4. Desk sales for students with nothing live: a 5-class pack, cash.
const noPlan = all.filter(({ st }) => st.kind === 'none' || st.kind === 'lapsed');
const sold = [];
await pool(noPlan, C, async ({ s, st }) => {
  const r = await call('desk:sell-pack', 'POST', `/schools/${s.id}/desk-payments`, s.owner.tok, { studentId: st.id, membershipPlanId: s.plans['5-class pack'], paymentMethod: 'CASH' });
  if (r.status < 300) sold.push({ s, st });
});
lap(`desk sales: ${sold.length}/${noPlan.length}`);

// 5. Waivers: every School publishes one; three in five students sign it.
const waivers = new Map();
await pool(cast.schools, 16, async (s) => {
  const r = await call('waiver:create', 'POST', `/schools/${s.id}/waivers`, s.owner.tok, { title: 'Liability waiver', body: `Training at ${s.country} — round 4 waiver.` });
  if (r.status < 300) waivers.set(s.id, r.body);
});
const signers = all.filter((_, i) => i % 5 < 3).filter(({ s }) => waivers.has(s.id));
await pool(signers, C, ({ s, st }) => { const w = waivers.get(s.id); return call('waiver:sign', 'POST', `/waivers/${w.id}/sign`, st.tok, { signerFullName: 'Round Four', signatureText: 'Round Four', waiverVersion: w.version }); });
await pool(bySize('xlarge'), 4, (s) => waivers.has(s.id) && call('waiver:remind-xlarge', 'POST', `/schools/${s.id}/waivers/${waivers.get(s.id).id}/remind`, s.owner.tok, {}));
lap(`waivers: ${waivers.size} published, ${signers.length} signing`);

// 6. Broadcasts: every School tells everyone; the very large ones reach 3,000+.
await pool(cast.schools, 16, (s) => call(`broadcast:${s.size}`, 'POST', `/schools/${s.id}/notifications/broadcast`, s.owner.tok, { title: 'Holiday hours', body: 'We close early on Friday.', audience: 'ALL' }));
lap('broadcasts sent');

// 7. Every background job, the way the scheduler would start it, timed.
const JOBS = ['class-occurrence-generation', 'membership-expiry-sweep', 'booking-no-show-processing', 'waitlist-cascade-processing', 'waiver-renewal-sweep', 'notification-unsnooze-sweep', 'entity-offboarding-purge', 'tenant-lifecycle-purge', 'charge-recurring', 'charge-due-reminder', 'charge-overdue-notice', 'charge-auto-pay', 'late-fee'];
const jobTimes = {};
for (const name of JOBS) {
  const q = new Queue(name, { connection: { url: process.env.REDIS_URL } });
  const ev = new QueueEvents(name, { connection: { url: process.env.REDIS_URL } });
  await ev.waitUntilReady();
  const j0 = Date.now();
  const job = await q.add('run', {});
  try { await job.waitUntilFinished(ev, 900e3); jobTimes[name] = { seconds: (Date.now() - j0) / 1000, ok: true }; }
  catch (e) { jobTimes[name] = { seconds: (Date.now() - j0) / 1000, ok: false, error: String(e.message).slice(0, 200) }; }
  await ev.close(); await q.close();
  lap(`job ${name}: ${JSON.stringify(jobTimes[name])}`);
}

// 8. The owner's everyday pages, at every School (latency by School size).
const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
await pool(cast.schools, 16, async (s) => {
  const t = s.owner.tok, z = s.size;
  await call(`page:dashboard:${z}`, 'GET', `/schools/${s.id}/dashboard`, t);
  await call(`page:students:${z}`, 'GET', `/schools/${s.id}/students`, t);
  await call(`page:students-all:${z}`, 'GET', `/schools/${s.id}/students?status=ALL`, t);
  await call(`page:search:${z}`, 'GET', `/schools/${s.id}/students?search=${encodeURIComponent('ma')}`, t);
  await call(`page:export:${z}`, 'GET', `/schools/${s.id}/students/export`, t);
  await call(`page:staff:${z}`, 'GET', `/schools/${s.id}/staff`, t);
  await call(`page:instructors:${z}`, 'GET', `/schools/${s.id}/instructors`, t);
  await call(`page:transactions:${z}`, 'GET', `/schools/${s.id}/transactions`, t);
  await call(`page:transactions-summary:${z}`, 'GET', `/schools/${s.id}/transactions/summary`, t);
  await call(`page:calendar-month:${z}`, 'GET', `/schools/${s.id}/timetable/calendar?from=${from}&to=${to}`, t);
  await call(`page:timetable:${z}`, 'GET', `/schools/${s.id}/timetable`, t);
  await call(`page:classes:${z}`, 'GET', `/schools/${s.id}/classes`, t);
  await call(`page:plans:${z}`, 'GET', `/schools/${s.id}/membership-plans`, t);
  await call(`page:members-unlimited:${z}`, 'GET', `/membership-plans/${s.plans.Unlimited}/members`, t);
  await call(`page:waivers:${z}`, 'GET', `/schools/${s.id}/waivers`, t);
  await call(`page:broadcasts:${z}`, 'GET', `/schools/${s.id}/notifications/broadcasts`, t);
  await call(`page:inbox:${z}`, 'GET', `/notifications/me`, t);
  await call(`page:cancellations:${z}`, 'GET', `/schools/${s.id}/cancellations`, t);
  await call(`page:branches:${z}`, 'GET', `/schools/${s.id}/branches`, t);
  await call(`page:disciplines:${z}`, 'GET', `/schools/${s.id}/disciplines`, t);
  await call(`page:school:${z}`, 'GET', `/schools/${s.id}`, t);
  await call(`page:birthdays:${z}`, 'GET', `/schools/${s.id}/birthdays`, t);
});
for (const f of cast.franchises) await call('page:franchise', 'GET', `/franchises/${f.id}`, f.owner.tok);
lap('pages read');

// --- Correctness ---
const over = await db.$queryRawUnsafe(`select c.id, c.capacity, count(b.*)::int n from "Class" c join "Booking" b on b."classId" = c.id and b.status in ('UPCOMING','COMPLETED') where c.capacity is not null group by c.id having count(b.*) > c.capacity limit 5`).catch((e) => [{ error: e.message }]);
ok('L1 no class holds more bookings than its capacity', over.length === 0, JSON.stringify(over));
const neg = await db.membership.count({ where: { classesRemaining: { lt: 0 } } });
ok('L2 no pack credit below zero', neg === 0, `${neg}`);
const dupBook = await db.$queryRawUnsafe(`select "classId","studentId", count(*)::int n from "Booking" where status in ('UPCOMING','COMPLETED') group by 1,2 having count(*) > 1 limit 5`).catch((e) => [{ error: e.message }]);
ok('L3 nobody holds two live bookings for one class', dupBook.length === 0, JSON.stringify(dupBook));
const dupAtt = await db.$queryRawUnsafe(`select "classId","studentId", count(*)::int n from "Booking" where status = 'COMPLETED' group by 1,2 having count(*) > 1 limit 5`).catch((e) => [{ error: e.message }]);
ok('L4 one attendance per student per class', dupAtt.length === 0, JSON.stringify(dupAtt));
const soldTx = await db.transaction.count({ where: { studentId: { in: sold.map((x) => x.st.id) } } });
ok('L5 one payment row per desk sale', soldTx === sold.length, `${soldTx} rows for ${sold.length} sales`);
const sigs = await db.waiverSignature.count({ where: { waiverId: { in: [...waivers.values()].map((w) => w.id) }, signedDate: { not: null } } }).catch(() => -1);
ok('L6 every signature recorded once', sigs === stats['waiver:sign']?.codes?.['201'], `${sigs} signed rows, ${stats['waiver:sign']?.codes?.['201']} 201s`);
const bc5 = Object.entries(stats).filter(([k]) => k.startsWith('broadcast:')).every(([, v]) => !Object.keys(v.codes).some((c) => c >= '500'));
ok('L7 no broadcast failed', bc5, JSON.stringify(Object.fromEntries(Object.entries(stats).filter(([k]) => k.startsWith('broadcast:')).map(([k, v]) => [k, v.codes]))));
const five = Object.entries(stats).filter(([, v]) => Object.keys(v.codes).some((c) => Number(c) >= 500 || c === 'NETERR')).map(([k, v]) => `${k} ${JSON.stringify(v.codes)}`);
ok('L8 no request returned a 500 anywhere', five.length === 0, five.join('; '));
const failedJobs = Object.entries(jobTimes).filter(([, v]) => !v.ok);
ok('L9 every background job finished', failedJobs.length === 0, JSON.stringify(failedJobs));

const rows = report(null, './life-latency.json');
const fs = await import('fs');
fs.writeFileSync(new URL('./life-jobs.json', import.meta.url), JSON.stringify(jobTimes, null, 1));
save();
lap('done');
await db.$disconnect();
