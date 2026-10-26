// Phase 3: try to break booking, schedule, check-in and grading. Uses the seeded cast.
import fs from 'fs';
import { db, call, pool, report, randomUUID, token, grant } from './lib.mjs';

const cast = JSON.parse(fs.readFileSync(new URL('./cast.json', import.meta.url)));
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const codes = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const now = Date.now();
const S = cast.schools;
const local = (s) => s.students.filter((x) => x.branch === s.branches[0]);
const subsOf = (s) => local(s).filter((x) => x.kind === 'sub');
const packsOf = (s) => local(s).filter((x) => x.kind === 'pack');
let k = 0;
const mkClass = async (s, cap, extra = {}) => {
  const r = await call('attack:mk-class', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branches[0], instructorId: s.instructor.id, title: `Attack ${k++}`, styles: [{ disciplineId: s.disciplineId, classType: s.classType }], startDate: new Date(now + 5 * 60e3).toISOString(), endDate: new Date(now + 65 * 60e3).toISOString(), ...(cap === null ? {} : { capacity: cap }), ...extra });
  if (r.status >= 300) throw new Error('mkClass ' + JSON.stringify(r.body));
  return r.body.id;
};
const upcoming = (classId) => db.booking.count({ where: { classId, status: 'UPCOMING' } });

// A1. Burst: 40 students at a 10-seat class, in all 30 schools at once (the 500s seen in run 2).
{
  const classes = await Promise.all(S.map((s) => mkClass(s, 10)));
  const rs = (await Promise.all(S.map((s, i) => Promise.all(subsOf(s).slice(60, 100).map((st) => call('A1:burst', 'POST', `/classes/${classes[i]}/book`, st.tok, {})))))).flat();
  const counts = await Promise.all(classes.map(upcoming));
  const c = codes(rs);
  ok('A1 burst: 30 classes × 40 bookers for 10 seats fill exactly, no 500s', counts.every((n) => n === 10) && !c[500] && !c[503], `codes ${JSON.stringify(c)}; seats taken ${[...new Set(counts)].join('/')}`);
}

// A2. Same student, same class, 20 parallel requests: exactly one booking.
{
  const s = S[0]; const st = subsOf(s)[110]; const cls = await mkClass(s, 40);
  const rs = await Promise.all(Array.from({ length: 20 }, () => call('A2:double-book', 'POST', `/classes/${cls}/book`, st.tok, {})));
  const n = await db.booking.count({ where: { classId: cls, studentId: st.id, status: 'UPCOMING' } });
  ok('A2 double-click booking: one booking only', n === 1, `codes ${JSON.stringify(codes(rs))}`);
}

// A3. Last pack credit: one credit left, 10 different classes booked at once.
{
  const s = S[1]; const st = packsOf(s)[5];
  await db.membership.updateMany({ where: { studentId: st.id, schoolId: s.id }, data: { classesRemaining: 1 } });
  const classes = await Promise.all(Array.from({ length: 10 }, () => mkClass(s, 40)));
  const rs = await Promise.all(classes.map((c) => call('A3:last-credit', 'POST', `/classes/${c}/book`, st.tok, {})));
  const m = await db.membership.findFirst({ where: { studentId: st.id, schoolId: s.id } });
  const n = await db.booking.count({ where: { studentId: st.id, classId: { in: classes }, status: 'UPCOMING' } });
  ok('A3 last credit spent once', n === 1 && m.classesRemaining === 0, `bookings ${n}, credits left ${m.classesRemaining}, codes ${JSON.stringify(codes(rs))}`);
}

// A4. Double cancel: 10 parallel cancels of one pack booking restore one credit.
{
  const s = S[2]; const st = packsOf(s)[6];
  await db.membership.updateMany({ where: { studentId: st.id, schoolId: s.id }, data: { classesRemaining: 3 } });
  const cls = await mkClass(s, 40);
  const b = await call('A4:book', 'POST', `/classes/${cls}/book`, st.tok, {});
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('A4:cancel', 'PATCH', `/bookings/${b.body.id}/cancel`, st.tok, {})));
  const m = await db.membership.findFirst({ where: { studentId: st.id, schoolId: s.id } });
  ok('A4 double cancel refunds once', m.classesRemaining === 3, `credits ${m.classesRemaining} (want 3), codes ${JSON.stringify(codes(rs))}`);
}

// A5. Book/cancel churn: 15 rounds of book+cancel in parallel streams keep credits exact.
{
  const s = S[3]; const st = packsOf(s)[7];
  await db.membership.updateMany({ where: { studentId: st.id, schoolId: s.id }, data: { classesRemaining: 5 } });
  const classes = await Promise.all(Array.from({ length: 5 }, () => mkClass(s, 40)));
  await Promise.all(classes.map(async (c) => { for (let r = 0; r < 3; r++) { const b = await call('A5:churn', 'POST', `/classes/${c}/book`, st.tok, {}); if (b.status === 201) await call('A5:churn', 'PATCH', `/bookings/${b.body.id}/cancel`, st.tok, {}); } }));
  const m = await db.membership.findFirst({ where: { studentId: st.id, schoolId: s.id } });
  const live = await db.booking.count({ where: { studentId: st.id, classId: { in: classes }, status: 'UPCOMING' } });
  ok('A5 book/cancel churn keeps credits exact', m.classesRemaining + live === 5, `credits ${m.classesRemaining} + live bookings ${live} (want 5)`);
}

// A6. Cross-tenant: school B student books school A class; staff A books/cancels/checks-in school B people.
{
  const A = S[4], B = S[5];
  const clsA = await mkClass(A, 40); const clsB = await mkClass(B, 40);
  const stA = subsOf(A)[3], stB = subsOf(B)[3];
  const r1 = await call('A6:xt', 'POST', `/classes/${clsA}/book`, stB.tok, {});
  const r2 = await call('A6:xt', 'POST', `/classes/${clsA}/book`, A.staff.tok, { studentId: stB.id });
  const r3 = await call('A6:xt', 'POST', `/classes/${clsB}/book`, A.staff.tok, { studentId: stB.id });
  const bB = await call('A6:book', 'POST', `/classes/${clsB}/book`, stB.tok, {});
  const r4 = await call('A6:xt', 'PATCH', `/bookings/${bB.body.id}/cancel`, A.owner.tok, {});
  const r5 = await call('A6:xt', 'POST', `/classes/${clsB}/attendance-scan`, A.instructor.tok, { studentId: stB.id });
  const r6 = await call('A6:xt', 'GET', `/classes/${clsB}/bookings`, A.owner.tok);
  const r7 = await call('A6:xt', 'POST', `/students/${stB.id}/ranks/${B.disciplineId}/promote`, A.owner.tok, { acknowledgeWithoutSkillSignoff: true });
  const r8 = await call('A6:xt', 'POST', `/classes/${clsA}/book`, stA.tok, { studentId: stB.id });
  const all = [r1, r2, r3, r4, r5, r6, r7, r8].map((r) => r.status);
  ok('A6 cross-tenant: every attempt refused', all.every((c) => c >= 400 && c < 500), all.join(' '));
}

// A7. Waitlist: join a class with free seats; join while booked; double join; positions unique.
{
  const s = S[6]; const cls = await mkClass(s, 2); const subs = subsOf(s);
  const j0 = await call('A7:wl', 'POST', `/classes/${cls}/waitlist`, subs[0].tok, {});
  await call('A7:book', 'POST', `/classes/${cls}/book`, subs[1].tok, {});
  const j1 = await call('A7:wl', 'POST', `/classes/${cls}/waitlist`, subs[1].tok, {});
  await call('A7:book', 'POST', `/classes/${cls}/book`, subs[2].tok, {});
  const js = await Promise.all(subs.slice(3, 23).map((st) => call('A7:wl', 'POST', `/classes/${cls}/waitlist`, st.tok, {})));
  const dbl = await Promise.all(Array.from({ length: 5 }, () => call('A7:wl', 'POST', `/classes/${cls}/waitlist`, subs[30].tok, {})));
  const pos = await db.waitlistEntry.findMany({ where: { classId: cls, status: 'WAITING' }, select: { position: true } });
  const uniq = new Set(pos.map((p) => p.position)).size === pos.length;
  ok('A7a waitlist positions unique under 20 parallel joins', uniq, `${pos.length} entries`);
  ok('A7b double join gives one entry', dbl.filter((r) => r.status === 201).length === 1, JSON.stringify(codes(dbl)));
  ok('A7c joining the waitlist of a class with free seats is refused', j0.status >= 400, `status ${j0.status}`);
  ok('A7d joining the waitlist while already booked is refused', j1.status >= 400, `status ${j1.status}`);
  // A freed seat: does a direct booker jump the queue before the waitlist is offered it?
  const b = await db.booking.findFirst({ where: { classId: cls, status: 'UPCOMING' } });
  const owner = s.students.find((x) => x.id === b.studentId);
  await call('A7:cancel', 'PATCH', `/bookings/${b.id}/cancel`, owner.tok, {});
  const jump = await call('A7:jump', 'POST', `/classes/${cls}/book`, subs[40].tok, {});
  ok('A7e a freed seat goes to the waitlist, not to someone who just books', jump.status >= 400, `direct booking status ${jump.status}`);
}

// A8. Capacity cut below bookings; archive with bookings.
{
  const s = S[7]; const cls = await mkClass(s, 10); const subs = subsOf(s);
  await Promise.all(subs.slice(0, 8).map((st) => call('A8:book', 'POST', `/classes/${cls}/book`, st.tok, {})));
  const cut = await call('A8:cut', 'PATCH', `/classes/${cls}`, s.owner.tok, { capacity: 3 });
  ok('A8a capacity cannot be cut below current bookings without warning', cut.status >= 400, `PATCH capacity 3 with 8 booked: ${cut.status}`);
  const arch = await call('A8:archive', 'POST', `/classes/${cls}/archive`, s.owner.tok, {});
  ok('A8b class with bookings cannot be archived', arch.status === 409, `status ${arch.status}`);
}

// A9. Timetable slot edits and the 4 weeks of classes already generated from it (Decision 322).
{
  const s = S[8];
  const future = async (slot) => db.class.findMany({ where: { timetableSlotId: slot, archivedAt: null, startDate: { gt: new Date() } }, include: { bookings: { where: { status: 'UPCOMING' } } }, orderBy: { startDate: 'asc' } });
  // Make sure slot 0 has a booked upcoming class.
  let cls0 = await future(s.slots[0]);
  const booker = subsOf(s)[90];
  await call('A9:book', 'POST', `/classes/${cls0[1].id}/book`, booker.tok, {});
  cls0 = await future(s.slots[0]);
  const bookedN = cls0.filter((c) => c.bookings.length).length;
  const ask = await call('A9:off-no-choice', 'PATCH', `/timetable/${s.slots[0]}`, s.owner.tok, { status: 'OFF' });
  const impact = await call('A9:impact', 'GET', `/timetable/${s.slots[0]}/upcoming-impact`, s.owner.tok);
  const pack = await db.membership.findFirst({ where: { studentId: booker.id, schoolId: s.id } });
  const off = await call('A9:off-cancel', 'PATCH', `/timetable/${s.slots[0]}`, s.owner.tok, { status: 'OFF', bookedClasses: 'CANCEL' });
  const left = await future(s.slots[0]);
  const after = await call('A9:book-after-off', 'POST', `/classes/${cls0[0].id}/book`, subsOf(s)[91].tok, {});
  const cancelled = await db.booking.count({ where: { studentId: booker.id, classId: cls0[1].id, status: 'CANCELLED', refundResolution: 'REFUNDED' } });
  ok('A9a switching off a slot with booked classes asks first', ask.status === 409 && bookedN > 0, `PATCH without a choice: ${ask.status} (${bookedN} booked classes); impact ${JSON.stringify(impact.body)}`);
  ok('A9b OFF + CANCEL removes every upcoming class and refunds the bookings', off.status === 200 && left.length === 0 && after.status >= 400 && cancelled === 1, `PATCH ${off.status}; ${left.length} upcoming classes left; booking one now: ${after.status}; refunded bookings ${cancelled}`);
  // Slot 1: move the start time with MOVE; bookings follow.
  let cls1 = await future(s.slots[1]);
  await call('A9:book', 'POST', `/classes/${cls1[0].id}/book`, subsOf(s)[92].tok, {});
  const mv = await call('A9:move', 'PATCH', `/timetable/${s.slots[1]}`, s.owner.tok, { startTime: '06:30', endTime: '07:30', capacity: 30, bookedClasses: 'MOVE' });
  cls1 = await future(s.slots[1]);
  const times = new Set(cls1.map((c) => c.startDate.toISOString().slice(11, 16)));
  const stillBooked = await db.booking.count({ where: { studentId: subsOf(s)[92].id, classId: { in: cls1.map((c) => c.id) }, status: 'UPCOMING' } });
  ok('A9c MOVE re-times every upcoming class, bookings follow', mv.status === 200 && cls1.every((c) => c.capacity === 30) && stillBooked === 1, `PATCH ${mv.status}; start times now ${[...times].join(',')}; capacities ${[...new Set(cls1.map((c) => c.capacity))].join(',')}; booking kept ${stillBooked}`);
  // Slot 2: change the weekday (unbooked only): no doubled classes.
  const s2 = s.slots[2]; const before2 = (await future(s2)).length;
  const wd = await call('A9:weekday', 'PATCH', `/timetable/${s2}`, s.owner.tok, { weekday: 'WEDNESDAY', bookedClasses: 'MOVE' });
  const cls2 = await future(s2);
  const days = new Set(cls2.map((c) => c.startDate.getUTCDay()));
  ok('A9d a new weekday moves the classes instead of adding a second set', wd.status === 200 && cls2.length <= 5 && days.size === 1, `PATCH ${wd.status}; ${before2} → ${cls2.length} upcoming classes on ${days.size} weekday(s)`);
}

// A10. Grading races: 10 parallel promotes without expectedCurrentRungId, and with it.
{
  const s = S[9]; const [st1, st2] = subsOf(s).slice(70, 72);
  const ev = async (id) => db.promotionEvent.count({ where: { studentId: id, type: 'PROMOTION' } });
  const b1 = await ev(st1.id), b2 = await ev(st2.id);
  await Promise.all(Array.from({ length: 10 }, () => call('A10:promote', 'POST', `/students/${st1.id}/ranks/${s.disciplineId}/promote`, s.owner.tok, { acknowledgeWithoutSkillSignoff: true })));
  const sr = await db.studentRank.findFirst({ where: { studentId: st2.id, disciplineId: s.disciplineId } });
  const rs = await Promise.all(Array.from({ length: 10 }, () => call('A10:promote-guarded', 'POST', `/students/${st2.id}/ranks/${s.disciplineId}/promote`, s.owner.tok, { acknowledgeWithoutSkillSignoff: true, expectedCurrentRungId: sr.currentStripeId })));
  const a1 = (await ev(st1.id)) - b1, a2 = (await ev(st2.id)) - b2;
  ok('A10a 10 parallel promotes with the expected rung promote once', a2 === 1, `${a2} promotions, codes ${JSON.stringify(codes(rs))}`);
  ok('A10b 10 parallel promotes without it (double-click) promote once', a1 === 1, `${a1} promotions`);
  const srNow = await db.studentRank.findFirst({ where: { studentId: st1.id, disciplineId: s.disciplineId } });
  const last = await db.promotionEvent.findFirst({ where: { studentId: st1.id, voidedAt: null }, orderBy: { createdAt: 'desc' } });
  ok('A10c rank matches the last history entry', last && last.toStripeTierId === srNow.currentStripeId, '');
}

// A11. Check-in race: instructor + self-service code at the same time; attendance counted once.
{
  const s = S[10]; const st = subsOf(s)[80]; const cls = await mkClass(s, 40);
  await call('A11:book', 'POST', `/classes/${cls}/book`, st.tok, {});
  const qr = await call('A11:qr', 'GET', `/classes/${cls}/qr-token`, s.instructor.tok);
  const sr0 = await db.studentRank.findFirst({ where: { studentId: st.id, disciplineId: s.disciplineId } });
  const rs = await Promise.all([
    ...Array.from({ length: 5 }, () => call('A11:checkin', 'POST', `/classes/${cls}/attendance-scan`, s.instructor.tok, { studentId: st.id })),
    ...Array.from({ length: 5 }, () => call('A11:checkin', 'POST', '/attendance/code', st.tok, { classId: cls, code: qr.body.code })),
  ]);
  const sr1 = await db.studentRank.findFirst({ where: { studentId: st.id, disciplineId: s.disciplineId } });
  const field = Object.keys(sr1).find((f) => /classesAttended|attendedClasses|classCount/i.test(f));
  ok('A11 simultaneous check-ins count once', rs.filter((r) => r.status < 300).length === 1 && (!field || sr1[field] - sr0[field] === 1), `codes ${JSON.stringify(codes(rs))}${field ? `, ${field} +${sr1[field] - sr0[field]}` : ''}`);
}

// A12. Cancel after the class has started (no refund cut-off set): credit back?
{
  const s = S[11]; const st = packsOf(s)[8];
  await db.membership.updateMany({ where: { studentId: st.id, schoolId: s.id }, data: { classesRemaining: 2 } });
  const r = await call('A12:mk', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branches[0], title: 'Started', styles: [{ disciplineId: s.disciplineId, classType: s.classType }], startDate: new Date(now - 20 * 60e3).toISOString(), endDate: new Date(now + 40 * 60e3).toISOString(), capacity: 40 });
  const b = await call('A12:book', 'POST', `/classes/${r.body.id}/book`, st.tok, {});
  const c = await call('A12:cancel', 'PATCH', `/bookings/${b.body.id}/cancel`, st.tok, {});
  const m = await db.membership.findFirst({ where: { studentId: st.id, schoolId: s.id } });
  ok('A12 cancelling after the class started keeps the credit spent', m.classesRemaining === 1, `cancel ${c.status}, credits ${m.classesRemaining} (2 before booking)`);
}

// A14. Raising a full class's capacity offers the new seats to the waitlist.
{
  const s = S[13]; const cls = await mkClass(s, 2); const subs = subsOf(s);
  await call('A14:book', 'POST', `/classes/${cls}/book`, subs[0].tok, {});
  await call('A14:book', 'POST', `/classes/${cls}/book`, subs[1].tok, {});
  for (const st of subs.slice(2, 5)) await call('A14:wl', 'POST', `/classes/${cls}/waitlist`, st.tok, {});
  const up = await call('A14:raise', 'PATCH', `/classes/${cls}`, s.owner.tok, { capacity: 4 });
  let notified = 0;
  for (let t = 0; t < 20 && notified < 2; t++) { await new Promise((r) => setTimeout(r, 500)); notified = await db.waitlistEntry.count({ where: { classId: cls, status: 'NOTIFIED' } }); }
  const direct = await call('A14:direct', 'POST', `/classes/${cls}/book`, subs[10].tok, {});
  ok('A14 raised capacity goes to the waitlist first', up.status === 200 && notified === 2 && direct.status === 409, `PATCH ${up.status}; notified ${notified}; direct booking ${direct.status}`);
}

// A13. Identity throttle: 30 students of one school booking from one IP within a minute.
{
  const s = S[12]; const cls = await mkClass(s, 40);
  const rs = await Promise.all(subsOf(s).slice(0, 30).map((st) => call('A13:same-ip', 'POST', `/classes/${cls}/book`, st.tok, {})));
  ok('A13 many students on one IP are not throttled together', !codes(rs)[429], JSON.stringify(codes(rs)));
}

report();
fs.writeFileSync(new URL('./attack-result.json', import.meta.url), JSON.stringify(results, null, 1));
await db.$disconnect();
