// 200 kids checking in with the app QR at one Branch's tablet in the 10 minutes before class.
import fs from 'fs';
import { db, call, grant, tokenRca, pool, report } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId; const B0 = C.branches[0];
const tOwner = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const st0 = C.bstaff[0]; const tSt0 = tokenRca(st0, [grant('BRANCH_STAFF', S, st0.branchId)]);
const out = {};
const codesOf = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const now = Date.now();
const cls = await call('class', 'POST', `/schools/${S}/classes`, tOwner, { branchId: B0, instructorId: C.instr[0].id, title: 'Kids rush 18:00', styles: C.styles, startDate: new Date(now + 8 * 60e3).toISOString(), endDate: new Date(now + 68 * 60e3).toISOString(), membershipInclusion: true, capacity: 250 });
out.class = `${cls.status} ${cls.body?.id || JSON.stringify(cls.body).slice(0, 200)}`;
const classId = cls.body.id;
const withM = new Set((await db.membership.findMany({ where: { schoolId: S }, select: { studentId: true } })).map((m) => m.studentId));
const kids = C.students.filter((s) => s.branch === B0 && s.home && withM.has(s.id) && s.dob > '2012-01-01').slice(0, 200);
const adults = C.students.filter((s) => s.branch === B0 && s.home && withM.has(s.id) && s.dob < '2000-01-01');
const people = [...kids, ...adults].slice(0, 200);
out.people = { kids: kids.length, total: people.length };
const tok = (s) => tokenRca(s, [grant('STUDENT', S, B0)]);
// Children can't book themselves; staff book them (front desk "book for").
const t0 = Date.now();
const books = await pool(people, 16, (s) => s.dob > '2008-11-05' ? call('book-staff', 'POST', `/classes/${classId}/book`, tSt0, { studentId: s.id }) : call('book-self', 'POST', `/classes/${classId}/book`, tok(s), {}));
out.book = { codes: codesOf(books), secs: (Date.now() - t0) / 1000, sampleErr: books.filter((r) => r.status >= 300).slice(0, 3).map((r) => JSON.stringify(r.body).slice(0, 160)) };
const sess = await call('s', 'POST', `/schools/${S}/front-desk/sessions`, tSt0, { branchId: B0 });
const kt = sess.body.sessionToken;
const t1 = Date.now();
const res = await pool(people, 16, async (s) => {
  const q = await call('my-qr', 'GET', '/attendance/my-qr-token', tok(s));
  if (q.status !== 200) return { step: 'qr', r: q };
  const l = await call('kiosk-qr-lookup', 'POST', '/front-desk/kiosk/qr-lookups', kt, { studentToken: q.body.token });
  if (l.status >= 300) return { step: 'lookup', r: l };
  const c = await call('kiosk-check-in', 'POST', '/front-desk/kiosk/check-ins', kt, { studentId: s.id, lookupToken: l.body.lookupToken, classIds: [classId] });
  return { step: 'checkin', r: c };
});
out.rush = { secs: (Date.now() - t1) / 1000, ok: res.filter((x) => x.step === 'checkin' && x.r.status < 300).length, fails: Object.entries(res.filter((x) => !(x.step === 'checkin' && x.r.status < 300)).reduce((m, x) => { const k = `${x.step} ${x.r.status} ${x.r.body?.error?.code || JSON.stringify(x.r.body).slice(0, 80)}`; m[k] = (m[k] || 0) + 1; return m; }, {})) };
// same kid scanned 5 times at once
const k0 = people[0];
const dbl = await Promise.all(Array.from({ length: 5 }, async () => {
  const q = await call('my-qr', 'GET', '/attendance/my-qr-token', tok(k0));
  const l = await call('kiosk-qr-lookup', 'POST', '/front-desk/kiosk/qr-lookups', kt, { studentToken: q.body.token });
  return call('kiosk-check-in-x5', 'POST', '/front-desk/kiosk/check-ins', kt, { studentId: k0.id, lookupToken: l.body?.lookupToken, classIds: [classId] });
}));
out.double = codesOf(dbl);
const att = await db.$queryRawUnsafe(`select count(*)::int n, count(distinct b."studentId")::int d from "Booking" b join "BookingAttendee" a on a."bookingId"=b.id where b."classId"=$1 and a."checkedInAt" is not null`, classId).catch((e) => String(e).slice(0, 200));
out.attendance = att;
out.bookings = await db.booking.count({ where: { classId, status: { in: ['UPCOMING', 'COMPLETED'] } } });
const today = await call('kiosk-today', 'GET', `/front-desk/kiosk/today?startsFrom=${encodeURIComponent(new Date(now - 6 * 3600e3).toISOString())}&startsTo=${encodeURIComponent(new Date(now + 18 * 3600e3).toISOString())}`, kt);
out.todayStatus = today.status; out.todayKb = Math.round(today.bytes / 1024);
fs.writeFileSync(new URL('./rush-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
report();
await db.$disconnect();
