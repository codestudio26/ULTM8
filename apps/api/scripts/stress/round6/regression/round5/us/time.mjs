// Round 5 US: timetable and time. Slots in four zones, a class across midnight,
// Thanksgiving / 4 July closures, a Branch time-zone fix after classes exist,
// a mistyped zone, the Dashboard week, and the generator job.
//   CAST=../empty-cast.json node time.mjs
import fs from 'fs';
import { db, call, grant, tokenRca, checks, Queue, QueueEvents } from '../../round4/common.mjs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const { DateTime } = require('luxon');

const C = JSON.parse(fs.readFileSync(new URL('./cast-us.json', import.meta.url)));
const S = C.schoolId;
const { ok, save } = checks('time');
const out = {};
const owner = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const br = Object.fromEntries(C.branches.map((b) => [b.name, b]));
const instrAt = (bid) => C.instructors.find((i) => i.branch === bid).id;
const zone = (b) => b.tz ?? 'America/New_York';
const local = (d, z) => DateTime.fromJSDate(d).setZone(z);

async function runJob(name, jobName = 'run') {
  const q = new Queue(name, { connection: { url: process.env.REDIS_URL } });
  const ev = new QueueEvents(name, { connection: { url: process.env.REDIS_URL } });
  await ev.waitUntilReady();
  const job = await q.add(jobName, {});
  try { await job.waitUntilFinished(ev, 600e3); return true; } catch (e) { return String(e.message); } finally { await q.close(); await ev.close(); }
}

// --- T1: weekly slots, every Branch: 06:00 daily-ish and an evening class.
const slotIds = {};
for (const b of C.branches) {
  for (const [wd, st, en, title] of [['MONDAY', '06:00', '07:00', '6am Sunrise MMA'], ['WEDNESDAY', '18:00', '19:30', 'Evening MMA'], ['THURSDAY', '06:00', '07:00', '6am Sunrise MMA'], ['SUNDAY', '01:30', '02:30', 'Night owl open mat']]) {
    const r = await call('slot', 'POST', `/schools/${S}/timetable`, owner, { branchId: b.id, instructorId: instrAt(b.id), weekday: wd, startTime: st, endTime: en, title, styles: C.styles, capacity: 30 });
    if (r.status >= 300) throw new Error('slot ' + JSON.stringify(r.body));
    slotIds[`${b.name}|${wd}|${st}`] = r.body.id;
  }
}
// Generated classes land at their own Branch's local time.
const gen = await db.class.findMany({ where: { schoolId: S, timetableSlotId: { not: null } }, include: { timetableSlot: true } });
const wrong = gen.filter((c) => { const b = C.branches.find((x) => x.id === c.branchId); return local(c.startDate, zone(b)).toFormat('HH:mm') !== c.timetableSlot.startTime.toISOString().slice(11, 16); });
ok('T1a generated classes at the Branch local time (4 zones)', gen.length >= 60 && wrong.length === 0, `${gen.length} classes, ${wrong.length} wrong`);

// --- T2: the 23:00–00:30 class across midnight.
const mid = await call('slot', 'POST', `/schools/${S}/timetable`, owner, { branchId: br['New York'].id, instructorId: instrAt(br['New York'].id), weekday: 'FRIDAY', startTime: '23:00', endTime: '00:30', title: 'Midnight Madness', styles: C.styles, capacity: 20 });
out.midnightSlot = { status: mid.status, body: mid.body };
ok('T2a weekly slot 23:00–00:30 accepted', mid.status === 201, `${mid.status} ${JSON.stringify(mid.body?.message)}`);
// One-off on Friday 13 Nov 2026 23:00 NY -> 00:30 Sat.
const oneOff = await call('class', 'POST', `/schools/${S}/classes`, owner, { branchId: br['New York'].id, instructorId: instrAt(br['New York'].id), title: 'Midnight Madness (one-off)', styles: C.styles, startDate: '2026-11-14T04:00:00.000Z', endDate: '2026-11-14T05:30:00.000Z', capacity: 20, membershipInclusion: true });
ok('T2b one-off class 23:00–00:30 accepted', oneOff.status === 201, String(oneOff.status));
const cal = await call('cal', 'GET', `/schools/${S}/timetable/calendar?from=2026-11-13&to=2026-11-14&branchId=${br['New York'].id}`, owner);
const mm = cal.body?.classes?.find((c) => c.id === oneOff.body?.id);
out.midnightCalendar = mm;
ok('T2c calendar puts it on Fri 13 Nov 23:00–00:30', mm && mm.date === '2026-11-13' && mm.startTime === '23:00' && mm.endTime === '00:30', JSON.stringify(mm && { date: mm.date, s: mm.startTime, e: mm.endTime }));

// --- T3: Thanksgiving, whole School, Thu 26 Nov 2026. Honolulu Wed 23:00 class must survive.
const hnlLate = await call('class', 'POST', `/schools/${S}/classes`, owner, { branchId: br.Honolulu.id, instructorId: instrAt(br.Honolulu.id), title: 'HNL late Wed', styles: C.styles, startDate: '2026-11-26T09:00:00.000Z', endDate: '2026-11-26T09:59:00.000Z', capacity: 20 });
const nyEarlyFri = await call('class', 'POST', `/schools/${S}/classes`, owner, { branchId: br['New York'].id, instructorId: instrAt(br['New York'].id), title: 'NY Fri 00:30', styles: C.styles, startDate: '2026-11-27T05:30:00.000Z', endDate: '2026-11-27T06:30:00.000Z', capacity: 20 });
const tg = await call('closure', 'POST', `/schools/${S}/closures`, owner, { startDate: '2026-11-26', endDate: '2026-11-26', reason: 'Thanksgiving' });
out.thanksgiving = tg.body;
const after = await db.class.findMany({ where: { schoolId: S, startDate: { gte: new Date('2026-11-25T00:00:00Z'), lt: new Date('2026-11-28T12:00:00Z') } }, include: { branch: true } });
const bad = after.filter((c) => { const d = local(c.startDate, c.branch?.timezone ?? 'America/New_York').toISODate(); return (d === '2026-11-26') !== (c.cancelledAt !== null); });
ok('T3a Thanksgiving cancels exactly the classes on 26 Nov local, per Branch', tg.status === 201 && bad.length === 0, `cancelled=${tg.body?.cancelledClasses}, wrong=${bad.map((c) => c.title + '@' + c.branch?.name).join(',')}`);
ok('T3b HNL Wed 23:00 (Thu 09:00 UTC) and NY Fri 00:30 (Fri 05:30 UTC) kept', after.find((c) => c.id === hnlLate.body.id)?.cancelledAt === null && after.find((c) => c.id === nyEarlyFri.body.id)?.cancelledAt === null);
// 4 July 2027 (a Sunday) Branch closure, LA only, beyond the generator horizon.
const j4 = await call('closure', 'POST', `/schools/${S}/closures`, owner, { startDate: '2027-07-04', endDate: '2027-07-05', reason: 'Independence Day (observed Mon)', branchId: br['Los Angeles'].id });
const calJ = await call('cal', 'GET', `/schools/${S}/timetable/calendar?from=2027-06-27&to=2027-07-11`, owner);
const laSundayLater = (calJ.body?.later || []).filter((l) => l.date === '2027-07-04' || l.date === '2027-07-05');
const laIds = new Set(Object.entries(slotIds).filter(([k]) => k.startsWith('Los Angeles|')).map(([, v]) => v));
ok('T3c 4 July closure hides LA, not other Branches, on the calendar', j4.status === 201 && laSundayLater.every((l) => !laIds.has(l.slotId)) && laSundayLater.length > 0, `${laSundayLater.length} later entries on 4/5 Jul, LA ones ${laSundayLater.filter((l) => laIds.has(l.slotId)).length}`);

// --- T4: a Branch whose zone is fixed after classes exist.
const tucson = await call('branch', 'POST', `/schools/${S}/branches`, owner, { name: 'Tucson (zone set late)' });
if (tucson.status >= 300) throw new Error('branch ' + JSON.stringify(tucson.body));
await db.roleGrant.create({ data: { id: crypto.randomUUID(), userId: C.instructors[0].id, role: 'INSTRUCTOR', schoolId: S, branchId: tucson.body.id } });
const tSlot = await call('slot', 'POST', `/schools/${S}/timetable`, owner, { branchId: tucson.body.id, instructorId: C.instructors[0].id, weekday: 'TUESDAY', startTime: '06:00', endTime: '07:00', title: 'Tucson 6am', styles: C.styles, capacity: 20 });
if (tSlot.status >= 300) throw new Error('tslot ' + JSON.stringify(tSlot.body));
const fix = await call('branch', 'PATCH', `/branches/${tucson.body.id}`, owner, { timezone: 'America/Phoenix' });
const jr = await runJob('class-occurrence-generation');
const tClasses = await db.class.findMany({ where: { timetableSlotId: tSlot.body.id }, orderBy: { startDate: 'asc' } });
const tLocal = tClasses.map((c) => local(c.startDate, 'America/Phoenix').toFormat('ccc d LLL HH:mm'));
out.tucson = { patch: fix.status, job: jr, classes: tLocal };
ok('T4a after the Branch zone is fixed, its 6am classes are at 6am Phoenix', fix.status === 200 && tLocal.every((s) => s.endsWith('06:00')), tLocal.join(', '));
const calT = await call('cal', 'GET', `/schools/${S}/timetable/calendar?from=2026-11-08&to=2026-12-05&branchId=${tucson.body.id}`, owner);
out.tucsonCalendar = (calT.body?.classes || []).map((c) => `${c.date} ${c.startTime}`);

// --- T5: a mistyped zone.
const flag = await call('branch', 'POST', `/schools/${S}/branches`, owner, { name: 'Flagstaff (typo zone)', timezone: 'Mountain Standard Time' });
out.typoBranch = { status: flag.status, tz: flag.body?.timezone };
if (flag.status < 300) {
  await db.roleGrant.create({ data: { id: crypto.randomUUID(), userId: C.instructors[0].id, role: 'INSTRUCTOR', schoolId: S, branchId: flag.body.id } });
  const fs1 = await call('slot', 'POST', `/schools/${S}/timetable`, owner, { branchId: flag.body.id, instructorId: C.instructors[0].id, weekday: 'TUESDAY', startTime: '06:00', endTime: '07:00', title: 'Flagstaff 6am', styles: C.styles, capacity: 20 });
  const n = fs1.body?.id ? await db.class.count({ where: { timetableSlotId: fs1.body.id } }) : null;
  const calF = await call('cal', 'GET', `/schools/${S}/timetable/calendar?from=2026-11-08&to=2026-11-21`, owner);
  out.typo = { slot: fs1.status, slotBody: fs1.status >= 300 ? fs1.body : undefined, classes: n, calendar: calF.status, calBody: calF.status >= 300 ? calF.body : undefined };
  ok('T5a a mistyped Branch zone is refused (or classes still made)', false, JSON.stringify(out.typo));
} else ok('T5a a mistyped Branch zone is refused', true, String(flag.status));

// --- T6: the Dashboard week for a Sunday-start School.
const sum = await call('sum', 'GET', `/schools/${S}/bookings/summary`, owner);
out.summary = { from: sum.body?.from, to: sum.body?.to };
const wkStart = DateTime.fromISO(sum.body?.from || '2000-01-01').weekday;
ok('T6a Dashboard week starts on Sunday (School weekStartsOn SUNDAY)', wkStart === 7, `${sum.body?.from} – ${sum.body?.to}`);

fs.writeFileSync(new URL('./time-out.json', import.meta.url), JSON.stringify(out, null, 1));
save();
await db.$disconnect();
process.exit(0);
