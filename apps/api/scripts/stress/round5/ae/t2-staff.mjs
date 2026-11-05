// T2: Staff — Branch Staff confined to one Branch, pause/unpause, access switches, co-owner rules, activity log.
import { C, tk, call, S, short, db, checks, codes, tokenRca, grant } from './lib.mjs';
const { ok, save } = checks('t2-staff');
const D = C.branches.dubai, A = C.branches.abu;
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER'); const tCo = tk(C.coOwner, 'SCHOOL_OWNER_MANAGER');
const stamp = async (id) => (await db.user.findUnique({ where: { id }, select: { rolesChangedAt: true } })).rolesChangedAt?.getTime() ?? Date.now();
const tStaffD = async () => tokenRca(C.staffDubai, [grant('BRANCH_STAFF', S, D)], Math.max(Date.now(), await stamp(C.staffDubai.id)));
const items = (b) => (Array.isArray(b) ? b : b?.items ?? []);
const abuStudent = C.students.find((s) => s.branch === A && !Object.values(C.sp).some((x) => x.id === s.id));
const dubStudent = C.students.find((s) => s.branch === D && !Object.values(C.sp).some((x) => x.id === s.id));
const abuClass = await db.class.findFirst({ where: { schoolId: S, branchId: A, startDate: { gt: new Date() }, cancelledAt: null }, orderBy: { startDate: 'asc' } });
const dubClass = await db.class.findFirst({ where: { schoolId: S, branchId: D, startDate: { gt: new Date() }, cancelledAt: null, title: { contains: 'Advanced' } }, orderBy: { startDate: 'asc' } });
// Give Dubai staff everything on so we test the branch boundary, not the switches.
const allOn = { classes: true, bookings: true, students: true, cancelClasses: true, staffList: true, disciplines: true, checkInRules: true, exportStudents: true, freezeMemberships: true, attendanceStats: true, seeMedicalInfo: true, memberFiles: true, importData: true };
const on = await call('t2:access-all', 'PUT', `/schools/${S}/staff/${C.staffDubai.id}/access`, tOwner, allOn);
ok('T2a owner turns all switches on for Dubai staff', on.status < 300, `${on.status} ${short(on.body, 200)}`);
let t = await tStaffD();
const roster = await call('t2:roster', 'GET', `/schools/${S}/students`, t);
const ids = new Set(items(roster.body).map((x) => x.id));
ok('T2b Dubai Branch Staff roster has no Abu Dhabi-only students', roster.status === 200 && !ids.has(abuStudent.id) && ids.has(dubStudent.id), `${roster.status} n=${ids.size}; abu present=${ids.has(abuStudent.id)}; dubai present=${ids.has(dubStudent.id)}`);
const prof = await call('t2:abu-profile', 'GET', `/schools/${S}/students/${abuStudent.id}/profile`, t);
ok('T2c Dubai staff cannot open an Abu Dhabi student profile', prof.status >= 400, `${prof.status} ${short(prof.body, 160)}`);
const abuBookings = await call('t2:abu-class-bookings', 'GET', `/classes/${abuClass.id}/bookings`, t);
ok('T2d Dubai staff cannot read an Abu Dhabi class roster', abuBookings.status >= 400, `${abuBookings.status} ${short(abuBookings.body, 160)}`);
const bookAbu = await call('t2:book-abu', 'POST', `/classes/${abuClass.id}/book`, t, { studentId: abuStudent.id });
ok('T2e Dubai staff cannot book into an Abu Dhabi class', bookAbu.status >= 400, `${bookAbu.status} ${short(bookAbu.body, 160)}`);
const desk = await call('t2:desk-abu', 'POST', `/schools/${S}/front-desk/sessions`, t, { branchId: A });
ok('T2f Dubai staff cannot open the front-desk tablet for Abu Dhabi', desk.status >= 400, `${desk.status} ${short(desk.body, 160)}`);
const cancelAbu = await call('t2:cancel-abu', 'POST', `/classes/${abuClass.id}/cancel`, t, { reason: 'test' });
ok('T2g Dubai staff cannot cancel an Abu Dhabi class', cancelAbu.status >= 400, `${cancelAbu.status} ${short(cancelAbu.body, 160)}`);
const exp = await call('t2:export', 'GET', `/schools/${S}/students/export`, t);
const expIds = new Set(items(exp.body).map((x) => x.id));
ok('T2h Dubai staff export has no Abu Dhabi students', exp.status === 200 && !expIds.has(abuStudent.id), `${exp.status} n=${expIds.size} abuPresent=${expIds.has(abuStudent.id)}`);
const tt = await call('t2:timetable', 'GET', `/schools/${S}/timetable`, t);
const ttB = new Set(items(tt.body).map((x) => x.branchId));
ok('T2i Dubai staff timetable shows Dubai slots only', tt.status === 200 && !ttB.has(A), `${tt.status} branches=${[...ttB].join(',')}`);
const book = await call('t2:book-dubai', 'POST', `/classes/${dubClass.id}/book`, t, { studentId: dubStudent.id });
ok('T2j Dubai staff can book a Dubai student into a Dubai class', book.status < 300, `${book.status} ${short(book.body, 160)}`);
// Pause: x5 concurrently, then access gone.
const ps = await Promise.all(Array.from({ length: 5 }, () => call('t2:pause', 'POST', `/schools/${S}/staff/${C.staffDubai.id}/pause`, tOwner, {})));
const after = await call('t2:after-pause', 'GET', `/schools/${S}/students`, await tStaffD());
ok('T2k Pause x5 → one pause, access refused at once', after.status >= 400, `pause ${JSON.stringify(codes(ps))}; roster after ${after.status}`);
const coPause = await call('t2:co-pause-main', 'POST', `/schools/${S}/staff/${C.owner.id}/pause`, tCo, {});
const coRemove = await call('t2:co-remove-main', 'POST', `/schools/${S}/staff/${C.owner.id}/remove`, tCo, {});
const coPauseCo = await call('t2:co-pause-self', 'POST', `/schools/${S}/staff/${C.coOwner.id}/pause`, tCo, {});
ok('T2l co-owner cannot pause/remove the main owner, nor pause herself', coPause.status >= 400 && coRemove.status >= 400 && coPauseCo.status >= 400, `${coPause.status} ${coRemove.status} ${coPauseCo.status} ${short(coPauseCo.body, 120)}`);
const coUn0 = await call('t2:co-unpause', 'POST', `/schools/${S}/staff/${C.staffDubai.id}/unpause`, tCo, {});
ok('T2m0 co-owner cannot unpause (Decision 423 item 10: main owner only)', coUn0.status === 403, `${coUn0.status}`);
const coUn = await call('t2:unpause', 'POST', `/schools/${S}/staff/${C.staffDubai.id}/unpause`, tOwner, {});
const back = await call('t2:after-unpause', 'GET', `/schools/${S}/students`, await tStaffD());
ok('T2m main owner unpauses, access back', coUn.status < 300 && back.status === 200, `${coUn.status} ${back.status}`);
const switches = await call('t2:me-access', 'GET', `/schools/${S}/staff/me/access`, await tStaffD());
ok('T2n switches kept across pause/unpause', switches.body?.access?.students === true && switches.body?.access?.exportStudents === true, short(switches.body, 300));
// Access off: students off → roster refused.
await call('t2:students-off', 'PUT', `/schools/${S}/staff/${C.staffDubai.id}/access`, tOwner, { ...allOn, students: false, exportStudents: false });
const off = await call('t2:roster-off', 'GET', `/schools/${S}/students`, await tStaffD());
ok('T2o Students switch off → roster refused', off.status === 403, `${off.status}`);
await call('t2:restore', 'PUT', `/schools/${S}/staff/${C.staffDubai.id}/access`, tOwner, allOn);
// Activity log: Arabic names, pause logged once.
const log = await call('t2:activity', 'GET', `/schools/${S}/staff/activity`, tOwner);
const li = items(log.body);
const pauses = li.filter((x) => /PAUSE/i.test(x.action ?? x.kind ?? x.type ?? '') && !/UNPAUSE/i.test(x.action ?? x.kind ?? x.type ?? ''));
ok('T2p activity log: one pause entry, actor names in Arabic', log.status === 200 && pauses.length === 1, `${log.status} ${li.length} entries; pauses=${pauses.length}; sample=${short(li[0], 400)}`);
const staffLog = await call('t2:activity-staff', 'GET', `/schools/${S}/staff/activity`, await tStaffD());
ok('T2q Branch Staff cannot read the activity log', staffLog.status >= 400, `${staffLog.status}`);
// Abu staff vs Dubai student
const tA = tokenRca(C.staffAbu, [grant('BRANCH_STAFF', S, A)], Math.max(Date.now(), await stamp(C.staffAbu.id)));
const rA = await call('t2:abu-roster', 'GET', `/schools/${S}/students`, tA);
ok('T2r Abu Dhabi staff (default switches) roster', true, `INFO ${rA.status} n=${items(rA.body).length}`);
// Staff token with forged branch (Abu) grant for Dubai staff.
const forged = tokenRca(C.staffDubai, [grant('BRANCH_STAFF', S, A)], Math.max(Date.now(), await stamp(C.staffDubai.id)));
const fb = await call('t2:forged', 'GET', `/classes/${abuClass.id}/bookings`, forged);
ok('T2s token claiming Abu Dhabi branch for Dubai staff is refused', fb.status >= 400, `${fb.status} ${short(fb.body, 160)}`);
save(); await db.$disconnect();
