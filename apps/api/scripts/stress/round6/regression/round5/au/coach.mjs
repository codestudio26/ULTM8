// Round 5 AU: the Coaches portal through the API (Decisions 184, 341, 387, 424, 425).
//   CAST=../empty-cast.json node coach.mjs
import fs from 'fs';
import { db, call, grant, tokenRca, checks, codes } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const { ok, save } = checks('coach');
const info = (id, d) => ok(id, true, 'INFO ' + d);
const sid = A.schoolId;
const stamp = async (id) => (await db.user.findUnique({ where: { id }, select: { rolesChangedAt: true } })).rolesChangedAt?.getTime() ?? Date.now();
const coach = (name) => A.coaches.find((c) => c.name === name);
const coachTok = async (name) => { const c = coach(name); return tokenRca({ id: c.id, email: 'x@x' }, [grant('INSTRUCTOR', sid, A.branches[c.b])], await stamp(c.id)); };
const owner = tokenRca({ id: A.owner, email: 'o@x' }, [grant('SCHOOL_OWNER_MANAGER', sid)]);
const stud = (id, b) => tokenRca({ id, email: 's@x' }, [grant('STUDENT', sid, A.branches[b])]);
const bruno = await coachTok('Bruno'), dylan = await coachTok('Dylan'), tom = await coachTok('Tom');
const sydStudents = A.students.filter((s) => s.b === 'syd' && A.memberships[s.id] && s.tag === 'adult');
const perStudents = A.students.filter((s) => s.b === 'per' && A.memberships[s.id] && s.tag === 'adult');
const lhiStudents = A.students.filter((s) => s.b === 'lhi' && A.memberships[s.id] && s.tag === 'adult');

// Book a few students into the "now" classes (students themselves).
const booked = {};
for (const [cls, list, b] of [['nowSyd', sydStudents, 'syd'], ['nowPer', perStudents, 'per'], ['nowLhi', lhiStudents, 'lhi'], ['nowSyd2', sydStudents.slice(10), 'syd']]) {
  booked[cls] = [];
  for (const s of list.slice(0, 5)) {
    const r = await call('book', 'POST', `/classes/${A.classes[cls]}/book`, stud(s.id, b), {});
    if (r.status >= 300 && r.status !== 409) console.log('book fail', cls, r.status, JSON.stringify(r.body).slice(0, 200));
  }
  booked[cls] = (await db.booking.findMany({ where: { classId: A.classes[cls], status: { in: ['UPCOMING', 'COMPLETED'] } }, orderBy: { createdAt: 'asc' }, select: { studentId: true } })).map((b) => b.studentId).filter((id) => list.some((s) => s.id === id));
}
info('C0 seeded bookings', JSON.stringify(Object.fromEntries(Object.entries(booked).map(([k, v]) => [k, v.length]))));

// C1 a coach's own upcoming classes, and what the plain list shows.
{
  const mine = await call('c1', 'GET', `/schools/${sid}/classes?when=upcoming&instructorId=${coach('Bruno').id}&limit=50`, bruno);
  const items = mine.body?.items ?? [];
  ok('C1a Bruno: when=upcoming&instructorId=me lists only his classes', mine.status === 200 && items.length > 0 && items.every((c) => c.instructorId === coach('Bruno').id), `${mine.status} ${items.length} items`);
  const all = await call('c1', 'GET', `/schools/${sid}/classes?limit=100`, bruno);
  const brs = new Set((all.body?.items ?? []).map((c) => c.branchId));
  const names = Object.fromEntries(Object.entries(A.branches).map(([k, v]) => [v, k]));
  info('C1b Bruno (Sydney coach): branches visible in the plain class list', `${all.status} ${[...brs].map((b) => names[b] ?? b).join(',')}`);
  const other = await call('c1', 'GET', `/schools/${sid}/classes?when=upcoming&instructorId=${coach('Dylan').id}&limit=50`, bruno);
  info('C1c Bruno asks for Perth coach Dylan\'s classes', `${other.status} ${(other.body?.items ?? []).length} items`);
  const lhi = await call('c1', 'GET', `/schools/${sid}/classes?when=upcoming&instructorId=${coach('Tom').id}&limit=50`, tom);
  info('C1d Tom (Lord Howe) upcoming classes, first 3 startDates', `${lhi.status} ${(lhi.body?.items ?? []).slice(0, 3).map((c) => c.startDate).join(' | ')}`);
}

// C2 roll call: own branch yes, other branch no.
{
  const own = await call('c2', 'GET', `/classes/${A.classes.nowSyd}/bookings`, bruno);
  const per = await call('c2', 'GET', `/classes/${A.classes.nowPer}/bookings`, bruno);
  const lhiByDylan = await call('c2', 'GET', `/classes/${A.classes.nowLhi}/bookings`, dylan);
  ok('C2a a coach sees the roll call of a class at their own Branch', own.status === 200 && (own.body?.items ?? own.body ?? []).length >= 1, `${own.status} ${(own.body?.items ?? []).length}`);
  ok('C2b a coach is refused the roll call of another Branch\'s class', per.status >= 400 && lhiByDylan.status >= 400, `Bruno→Perth ${per.status}, Dylan→LHI ${lhiByDylan.status} ${JSON.stringify(per.body).slice(0, 120)}`);
  const qr = await call('c2', 'GET', `/classes/${A.classes.nowPer}/qr-token`, bruno);
  ok('C2c a coach cannot show the QR of another Branch\'s class', qr.status >= 400, `${qr.status}`);
}

// C3 coach attendance taking.
{
  const s = booked.nowSyd[0];
  const m = await call('c3', 'POST', `/classes/${A.classes.nowSyd}/attendance-scan`, bruno, { studentId: s });
  ok('C3a coach marks a booked student present (manual roll call)', m.status < 300 && m.body?.checkInMethod === 'INSTRUCTOR_MANUAL', `${m.status} ${m.body?.checkInMethod ?? JSON.stringify(m.body).slice(0, 150)}`);
  const twice = await Promise.all(Array.from({ length: 6 }, () => call('c3', 'POST', `/classes/${A.classes.nowSyd}/attendance-scan`, bruno, { studentId: booked.nowSyd[1] })));
  const att = await db.booking.count({ where: { studentId: booked.nowSyd[1], classId: A.classes.nowSyd, checkInMethod: { not: null } } });
  ok('C3b six roll-call taps at once check in once', att === 1 || (att === -1 && twice.filter((r) => r.status < 300).length >= 1), `${JSON.stringify(codes(twice))} attendance rows ${att}`);
  const xb = await call('c3', 'POST', `/classes/${A.classes.nowPer}/attendance-scan`, bruno, { studentId: booked.nowPer[0] });
  ok('C3c a Sydney coach cannot check in a student at a Perth class', xb.status >= 400, `${xb.status} ${JSON.stringify(xb.body).slice(0, 120)}`);
  const otherCoach = await call('c3', 'POST', `/classes/${A.classes.nowSyd2}/attendance-scan`, bruno, { studentId: booked.nowSyd2[0] });
  info('C3d Bruno marks present at Kirra\'s class at the same Branch', `${otherCoach.status} ${otherCoach.body?.checkInMethod ?? JSON.stringify(otherCoach.body).slice(0, 120)}`);
  // QR: the student's own rotating token, scanned by the coach.
  const sTok = stud(booked.nowSyd[2], 'syd');
  const myQr = await call('c3', 'GET', '/attendance/my-qr-token', sTok);
  const scan = await call('c3', 'POST', `/classes/${A.classes.nowSyd}/attendance-scan`, bruno, { studentId: booked.nowSyd[2], studentToken: myQr.body?.token ?? myQr.body?.qrToken });
  ok('C3e coach scans the student\'s app QR', scan.status < 300 && scan.body?.checkInMethod === 'INSTRUCTOR_SCAN', `qr ${myQr.status} ${Object.keys(myQr.body ?? {})}; scan ${scan.status} ${scan.body?.checkInMethod ?? JSON.stringify(scan.body).slice(0, 150)}`);
  const wrong = await call('c3', 'POST', `/classes/${A.classes.nowSyd}/attendance-scan`, bruno, { studentId: booked.nowSyd[3], studentToken: myQr.body?.token ?? myQr.body?.qrToken });
  ok('C3f someone else\'s QR for a different student is refused', wrong.status === 400, `${wrong.status}`);
  // The class QR shown by the coach, scanned by a student (student app POST /attendance/scan).
  const cq = await call('c3', 'GET', `/classes/${A.classes.nowSyd}/qr-token`, bruno);
  const s4 = booked.nowSyd[3];
  const sc = await call('c3', 'POST', '/attendance/scan', stud(s4, 'syd'), { classId: A.classes.nowSyd, qrToken: cq.body?.token ?? cq.body?.qrToken });
  ok('C3g student scans the class QR from the coach\'s screen', cq.status === 200 && sc.status < 300, `qr ${cq.status} ${Object.keys(cq.body ?? {})}; scan ${sc.status} ${JSON.stringify(sc.body).slice(0, 150)}`);
  const xq = await call('c3', 'POST', '/attendance/scan', stud(booked.nowPer[1], 'per'), { classId: A.classes.nowPer, qrToken: cq.body?.token ?? cq.body?.qrToken });
  ok('C3h a Sydney class QR does not check anyone into a Perth class', xq.status >= 400, `${xq.status} ${JSON.stringify(xq.body).slice(0, 120)}`);
}

// C4 Students for coaches (Decision 425 Q2: read only; Decision 341: their branch's students).
{
  const r = await call('c4', 'GET', `/schools/${sid}/students`, bruno);
  const items = r.body?.items ?? r.body ?? [];
  const byB = {}; for (const it of items) { const s = A.students.find((x) => x.id === (it.id ?? it.userId ?? it.studentId)); const k = s?.b ?? '?'; byB[k] = (byB[k] || 0) + 1; }
  info('C4a Sydney coach student list: rows by home Branch', `${r.status} ${items.length} rows ${JSON.stringify(byB)}`);
  const perId = perStudents[0].id;
  const detail = await call('c4', 'GET', `/students/${perId}/bookings`, bruno);
  info('C4b Sydney coach reads a Perth student\'s bookings', `${detail.status}`);
  const edit = await call('c4', 'PATCH', `/schools/${sid}/students/${sydStudents[0].id}`, bruno, { firstName: 'Hacked' });
  const edit2 = await call('c4', 'PATCH', `/students/${sydStudents[0].id}`, bruno, { firstName: 'Hacked' });
  ok('C4c a coach cannot edit a student (read only)', edit.status >= 400 && edit2.status >= 400, `${edit.status} ${edit2.status}`);
  const med = await call('c4', 'GET', `/students/${A.special.medical}/medical-info`, bruno);
  info('C4d coach reads medical info of a student at their Branch', `${med.status} ${JSON.stringify(med.body).slice(0, 120)}`);
  const exp = await call('c4', 'GET', `/schools/${sid}/students/export`, bruno);
  ok('C4e a coach cannot export the roster', exp.status >= 400, `${exp.status}`);
}

// C5 owner-only things a coach must not do.
{
  const r = await Promise.all([
    call('c5', 'GET', `/schools/${sid}/staff/activity`, bruno),
    call('c5', 'PUT', `/schools/${sid}/staff/${A.staffSyd}/access`, bruno, { classes: true, bookings: true, students: true, cancelClasses: true, staffList: true, inviteCoaches: true, disciplines: true }),
    call('c5', 'POST', `/schools/${sid}/staff/${coach('Kirra').id}/pause`, bruno, {}),
    call('c5', 'POST', `/schools/${sid}/classes`, bruno, { branchId: A.branches.per, instructorId: coach('Bruno').id, title: 'Rogue', styles: [{ disciplineId: A.bjj, classType: null }], startDate: new Date(Date.now() + 5 * 86400e3).toISOString(), endDate: new Date(Date.now() + 5 * 86400e3 + 3600e3).toISOString(), capacity: 10 }),
    call('c5', 'POST', `/schools/${sid}/closures`, bruno, { startDate: '2026-12-25', endDate: '2026-12-25', reason: 'xmas' }),
    call('c5', 'POST', `/users/${A.newStaff}/role-grants`, bruno, { role: 'INSTRUCTOR', schoolId: sid, branchId: A.branches.syd }),
    call('c5', 'POST', `/schools/${sid}/main-owner`, bruno, { userId: coach('Bruno').id }),
    call('c5', 'GET', `/schools/${sid}/staff/settings`, bruno),
  ]);
  ok('C5 a coach is refused: activity log, access switches, pause, class at another Branch, closures, giving roles, main owner, staff settings', r.every((x) => x.status >= 400), r.map((x) => x.status).join(','));
  const cancel = await call('c5', 'POST', `/classes/${A.classes.tomorrow}/cancel`, await coachTok('Kirra'), { reason: 'sick' });
  info('C5b a coach cancels another coach\'s class at their Branch', `${cancel.status} ${JSON.stringify(cancel.body).slice(0, 120)}`);
  const ownCls = await call('c5', 'POST', `/schools/${sid}/classes`, bruno, { branchId: A.branches.syd, instructorId: coach('Bruno').id, title: 'Bruno extra', styles: [{ disciplineId: A.bjj, classType: null }], startDate: new Date(Date.now() + 5 * 86400e3).toISOString(), endDate: new Date(Date.now() + 5 * 86400e3 + 3600e3).toISOString(), capacity: 10 });
  info('C5c a coach creates a class at their own Branch', `${ownCls.status} ${JSON.stringify(ownCls.body).slice(0, 120)}`);
  const book = await call('c5', 'POST', `/classes/${A.classes.nowSyd}/book`, bruno, { studentId: sydStudents[20].id });
  const bookPer = await call('c5', 'POST', `/classes/${A.classes.nowPer}/book`, bruno, { studentId: perStudents[20].id });
  info('C5d a coach books a student into own-Branch class / Perth class', `${book.status} / ${bookPer.status} ${JSON.stringify(bookPer.body).slice(0, 100)}`);
}

// C6 a coach who also trains (Aisha: INSTRUCTOR + STUDENT at Sydney).
{
  const a = coach('Aisha');
  const both = tokenRca({ id: a.id, email: 'a@x' }, [grant('INSTRUCTOR', sid, A.branches.syd), grant('STUDENT', sid, A.branches.syd)], await stamp(a.id));
  const b = await call('c6', 'POST', `/classes/${A.classes.nowSyd2}/book`, both, {});
  const me = await call('c6', 'GET', '/bookings/me', both);
  ok('C6 a coach who also trains books her own place and sees it in My bookings', b.status < 300 && (me.body?.items ?? me.body ?? []).some((x) => x.classId === A.classes.nowSyd2), `${b.status} ${JSON.stringify(b.body).slice(0, 100)}; me ${me.status}`);
}

// C7 Branch Staff (Decision 425 Q1): classes at their branch; with bookings off, no roll call.
{
  const bea = tokenRca({ id: A.staffSyd, email: 'b@x' }, [grant('BRANCH_STAFF', sid, A.branches.syd)], await stamp(A.staffSyd));
  const list = await call('c7', 'GET', `/schools/${sid}/classes?when=upcoming&limit=100`, bea);
  const names = Object.fromEntries(Object.entries(A.branches).map(([k, v]) => [v, k]));
  const brs = [...new Set((list.body?.items ?? []).map((c) => names[c.branchId] ?? c.branchId))];
  ok('C7a Sydney Branch Staff see only Sydney (and School-wide) classes', list.status === 200 && brs.every((b) => b === 'syd' || b === null), `${list.status} ${brs}`);
  const per = await call('c7', 'GET', `/classes/${A.classes.nowPer}/bookings`, bea);
  ok('C7b ...and not a Perth class roll call', per.status >= 400, `${per.status}`);
}

save();
await db.$disconnect();
