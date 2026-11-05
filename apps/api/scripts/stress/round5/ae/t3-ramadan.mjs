// T3: Ramadan timetable, Eid closures, midnight classes, women-only classes, Friday prayer.
import { C, tk, call, S, short, db, checks, codes } from './lib.mjs';
const { ok, save } = checks('t3-ramadan');
const D = C.branches.dubai, A = C.branches.abu;
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
// --- Ramadan: move Monday beginners 18:00 → after iftar/taraweeh 21:30-23:00 (MOVE), then to 22:30-00:00 (across midnight) ---
const slot = C.slots.find((s) => s.title === 'مواي تاي للمبتدئين');
const next = await db.class.findFirst({ where: { timetableSlotId: slot.id, startDate: { gt: new Date() } }, orderBy: { startDate: 'asc' } });
const stu = C.students.find((s) => s.branch === D && s.id !== C.sp.toddler.id && !Object.values(C.sp).some((x) => x.id === s.id));
const b = await call('t3:book', 'POST', `/classes/${next.id}/book`, tk(stu, 'STUDENT', D), {});
ok('T3a member books Monday beginners', b.status === 201, `${b.status} ${short(b.body, 160)}`);
const mv = await call('t3:ramadan-move', 'PATCH', `/timetable/${slot.id}`, tOwner, { startTime: '21:30', endTime: '23:00', bookedClasses: 'MOVE' });
const after = await db.class.findUnique({ where: { id: next.id } });
const local = after.startDate.toLocaleString('en-GB', { timeZone: 'Asia/Dubai' });
ok('T3b Ramadan: slot moved to 21:30 (after iftar), booked class follows', mv.status < 300 && local.includes('21:30'), `${mv.status} ${short(mv.body?.message ?? mv.body?.error ?? '', 160)} class now ${local}`);
const mid = await call('t3:ramadan-midnight', 'PATCH', `/timetable/${slot.id}`, tOwner, { startTime: '22:30', endTime: '00:00', bookedClasses: 'MOVE' });
ok('T3c Ramadan late class 22:30–00:00 as a weekly slot', mid.status < 300, `${mid.status} ${short(mid.body, 200)}`);
const mid2 = await call('t3:ramadan-midnight2', 'POST', `/schools/${S}/timetable`, tOwner, { branchId: D, instructorId: C.instrs[0].id, weekday: 'THURSDAY', startTime: '23:30', endTime: '01:00', title: 'سحور فِت Suhoor Fit', styles: C.styles2, capacity: 20 });
ok('T3d Ramadan Suhoor class 23:30–01:00 as a weekly slot', mid2.status < 300, `${mid2.status} ${short(mid2.body, 200)}`);
// One-off class across midnight works?
const s0 = new Date(next.startDate.getTime() + 2 * 86400e3); const dayStr = ymd(s0);
const st = new Date(`${dayStr}T23:30:00+04:00`), en = new Date(`${dayStr}T23:30:00+04:00`); en.setTime(st.getTime() + 90 * 60e3);
const one = await call('t3:oneoff-midnight', 'POST', `/schools/${S}/classes`, tOwner, { branchId: D, instructorId: C.instrs[0].id, title: 'سحور فِت (مرة واحدة)', styles: C.styles2, startDate: st.toISOString(), endDate: en.toISOString(), capacity: 20, membershipInclusion: true });
ok('T3e one-off class 23:30–01:00 across midnight', one.status === 201, `${one.status} ${short(one.body?.id ?? one.body, 160)}`);
const ob = await call('t3:oneoff-book', 'POST', `/classes/${one.body?.id}/book`, tk(stu, 'STUDENT', D), {});
ok('T3f member books the across-midnight one-off class', ob.status === 201, `${ob.status} ${short(ob.body, 160)}`);
// Move back after Ramadan
await call('t3:restore', 'PATCH', `/timetable/${slot.id}`, tOwner, { startTime: '18:00', endTime: '19:30', bookedClasses: 'MOVE' });
// --- Eid closure on the next 3 days that have classes, Dubai only ---
const firstDay = new Date(Date.now() + 7 * 86400e3); const d1 = ymd(firstDay); const d3 = ymd(new Date(firstDay.getTime() + 2 * 86400e3));
const bookedThere = await db.class.findFirst({ where: { schoolId: S, branchId: D, cancelledAt: null, startDate: { gte: new Date(`${d1}T00:00:00+04:00`), lt: new Date(`${d1}T23:59:00+04:00`) } } });
let eidBook = null;
if (bookedThere) eidBook = await call('t3:eid-book', 'POST', `/classes/${bookedThere.id}/book`, tk(stu, 'STUDENT', D), {});
const cl = await call('t3:eid', 'POST', `/schools/${S}/closures`, tOwner, { startDate: d1, endDate: d3, reason: 'عيد الفطر المبارك 🌙 Eid al-Fitr', branchId: D });
const cancelled = await db.class.count({ where: { schoolId: S, branchId: D, cancelledAt: { not: null }, startDate: { gte: new Date(`${d1}T00:00:00+04:00`), lt: new Date(`${d3}T23:59:59+04:00`) } } });
const abuStill = await db.class.count({ where: { schoolId: S, branchId: A, cancelledAt: null, startDate: { gte: new Date(`${d1}T00:00:00+04:00`), lt: new Date(`${d3}T23:59:59+04:00`) } } });
ok('T3g Eid closure (Dubai) cancels Dubai classes on those local dates only', cl.status === 201 && cl.body.cancelledClasses === cancelled && cancelled > 0, `${cl.status} cancelledClasses=${cl.body?.cancelledClasses} db=${cancelled}; Abu Dhabi classes untouched=${abuStill}; booked ${eidBook?.status}`);
await new Promise((r) => setTimeout(r, 4000));
const n = await db.notification.findMany({ where: { userId: stu.id }, orderBy: { createdAt: 'desc' }, take: 5, select: { title: true, body: true, type: true } });
ok('T3h booked member told about Eid closure (notice carries Arabic reason)', n.some((x) => x.body.includes('عيد الفطر')), short(n, 600));
// Moon sighting: Eid moves one day later → delete and re-create
const del = await call('t3:eid-del', 'DELETE', `/closures/${cl.body.id}`, tOwner);
const stillCancelled = await db.class.findUnique({ where: { id: bookedThere?.id ?? next.id }, select: { cancelledAt: true } });
const d2 = ymd(new Date(firstDay.getTime() + 86400e3)), d4 = ymd(new Date(firstDay.getTime() + 3 * 86400e3));
const cl2 = await call('t3:eid-shift', 'POST', `/schools/${S}/closures`, tOwner, { startDate: d2, endDate: d4, reason: 'عيد الفطر (بعد رؤية الهلال)', branchId: D });
const bk = eidBook?.body?.id ? await db.booking.findUnique({ where: { id: eidBook.body.id }, select: { status: true } }) : null;
ok('T3i moon-sighting shift: after deleting the closure, the first day\'s classes come back', !stillCancelled?.cancelledAt, `delete ${del.status}; class on ${d1} cancelledAt=${stillCancelled?.cancelledAt?.toISOString()}; booking=${bk?.status}; new closure ${cl2.status}`);
const patch = await call('t3:eid-patch', 'PATCH', `/closures/${cl2.body?.id}`, tOwner, { startDate: d2 });
ok('T3j a closure can be edited (dates)', patch.status < 300, `INFO ${patch.status}`);
// Past/odd closure inputs
const bad = await Promise.all([
  call('t3:cl-hijri', 'POST', `/schools/${S}/closures`, tOwner, { startDate: '1448-10-01', endDate: '1448-10-03', reason: 'Hijri date' }),
  call('t3:cl-arabic-digits', 'POST', `/schools/${S}/closures`, tOwner, { startDate: '٢٠٢٧-٠٣-١٠', endDate: '٢٠٢٧-٠٣-١٢', reason: 'Arabic digits' }),
  call('t3:cl-long', 'POST', `/schools/${S}/closures`, tOwner, { startDate: '2027-03-10', endDate: '2028-03-12', reason: 'x' }),
  call('t3:cl-staff', 'POST', `/schools/${S}/closures`, tk(C.staffDubai, 'BRANCH_STAFF', D), { startDate: '2027-03-10', endDate: '2027-03-12', reason: 'staff' }),
]);
ok('T3k closure refuses Hijri-year date, Arabic-Indic digits, >1 year, Branch Staff', bad.every((r) => r.status >= 400 && r.status < 500), bad.map((r) => `${r.status}:${short(r.body?.error?.message, 80)}`).join(' | '));
// Eid al-Adha future closure far ahead (2027-05-16..19) → generation should skip later
const adha = await call('t3:adha', 'POST', `/schools/${S}/closures`, tOwner, { startDate: '2027-05-16', endDate: '2027-05-19', reason: 'عيد الأضحى' });
ok('T3l future Eid al-Adha closure accepted', adha.status === 201, `${adha.status}`);
// --- Women-only class: a male member books "Ladies only" ---
const ladies = C.slots.find((s) => s.title.startsWith('لياقة للسيدات'));
const lc = await db.class.findFirst({ where: { timetableSlotId: ladies.id, startDate: { gt: new Date() }, cancelledAt: null }, orderBy: { startDate: 'asc' } });
const male = await db.user.findFirst({ where: { id: { in: C.students.filter((s) => s.branch === D).map((s) => s.id) }, gender: 'MALE', dateOfBirth: { lt: new Date(Date.now() - 20 * 365 * 86400e3) } } });
const mb = await call('t3:male-ladies', 'POST', `/classes/${lc.id}/book`, tk(male, 'STUDENT', D), {});
ok('T3m INFO: a male member can book the women-only class (no gender rule exists)', true, `INFO ${mb.status} ${short(mb.body?.status ?? mb.body, 120)}`);
save(); await db.$disconnect();
