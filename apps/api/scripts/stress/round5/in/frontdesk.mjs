// Decision 417 at 4,000 students: 6-digit codes, the tablet lock, plus a check-in rush.
import fs from 'fs';
import { db, call, grant, tokenRca, pool, randomUUID, report } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId; const B0 = C.branches[0];
const tOwner = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const out = {};
const sh = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`;
const codesOf = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

// F0: plant 4-digit codes, as if issued while the School was small
const b0 = C.students.filter((s) => s.branch === B0);
await db.studentCheckInCode.deleteMany({ where: { schoolId: S } });
await db.school.update({ where: { id: S }, data: { checkInCodeDigits: 4 } });
await db.studentCheckInCode.createMany({ data: b0.slice(0, 50).map((s, i) => ({ id: randomUUID(), schoolId: S, studentId: s.id, code: String(1000 + i) })) });
out.F0_before = (await db.school.findUnique({ where: { id: S }, select: { checkInCodeDigits: true } })).checkInCodeDigits;
// A tablet can still use an old 4-digit code until something enforces 6
let sess = await call('fd-start', 'POST', `/schools/${S}/front-desk/sessions`, tOwner, { branchId: B0 });
let kt = sess.body.sessionToken;
out.F0_old4digitLookupBeforeSweep = sh(await call('code', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: '1000' }));

// F1: issue codes for every member at Branch 1 (500), time it; check digits and old codes replaced
const t0 = Date.now();
const iss = await pool(b0, 16, (s) => call('issue-code', 'GET', `/schools/${S}/students/${s.id}/check-in-code`, tOwner));
out.F1 = { n: b0.length, codes: codesOf(iss), secs: (Date.now() - t0) / 1000, lens: [...new Set(iss.map((r) => r.body?.code?.length))], digits: (await db.school.findUnique({ where: { id: S }, select: { checkInCodeDigits: true } })).checkInCodeDigits };
out.F1_old4digitAfter = sh(await call('code', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: '1001' }));
out.F1_short = await db.studentCheckInCode.count({ where: { schoolId: S, code: { not: { startsWith: '' } } } });
out.F1_set4 = sh(await call('rules', 'PUT', `/schools/${S}/check-in-rules`, tOwner, { ...(await call('rules-get', 'GET', `/schools/${S}/check-in-rules`, tOwner)).body, checkInCodeDigits: 4 }));
// Staff codes (Branch Staff at Branch 1 and Branch 2)
const st0 = C.bstaff[0]; const st1 = C.bstaff[1];
const tSt0 = tokenRca(st0, [grant('BRANCH_STAFF', S, st0.branchId)]);
const tSt1 = tokenRca(st1, [grant('BRANCH_STAFF', S, st1.branchId)]);
const code0 = (await call('my-code', 'GET', `/schools/${S}/front-desk/my-code`, tSt0)).body?.code;
const code1 = (await call('my-code', 'GET', `/schools/${S}/front-desk/my-code`, tSt1)).body?.code;
out.F1_staffCodes = [code0, code1];

// F2: lock after 10 wrong member codes in a row
const taken = new Set((await db.studentCheckInCode.findMany({ where: { schoolId: S }, select: { code: true } })).map((r) => r.code));
const wrong = () => { let c; do { c = String(Math.floor(Math.random() * 1e6)).padStart(6, '0'); } while (taken.has(c)); return c; };
const rightCode = iss.find((r) => r.status === 200).body.code;
sess = await call('fd-start', 'POST', `/schools/${S}/front-desk/sessions`, tSt0, { branchId: B0 });
kt = sess.body.sessionToken;
const seq = [];
for (let i = 0; i < 10; i++) seq.push((await call('code-wrong', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: wrong() })).status);
out.F2_tenWrong = seq.join(',');
const locked = {
  session: (await call('k', 'GET', '/front-desk/kiosk/session', kt)).body?.locked,
  rightCode: (await call('k', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: rightCode })).status,
  today: (await call('k', 'GET', '/front-desk/kiosk/today', kt)).status,
  search: (await call('k', 'GET', '/front-desk/kiosk/students?search=Aarav', kt)).status,
  card: (await call('k', 'GET', `/front-desk/kiosk/students/${b0[0].id}/card`, kt)).status,
  findMe: (await call('k', 'POST', '/front-desk/kiosk/find-me', kt, { fullName: 'Aarav Sharma', dateOfBirth: '2015-01-01' })).status,
  signUp: (await call('k', 'POST', '/front-desk/kiosk/sign-ups', kt, { firstName: 'X', surname: 'Y', email: 'r5-in-x@stress.test', dateOfBirth: '1990-01-01' })).status,
  checkIn: (await call('k', 'POST', '/front-desk/kiosk/check-ins', kt, { studentId: b0[0].id, classIds: [] })).status,
  qr: (await call('k', 'POST', '/front-desk/kiosk/qr-lookups', kt, { studentToken: 'x' })).status,
};
out.F2_whileLocked = locked;
out.F2_resumeOtherBranchStaff = sh(await call('resume', 'POST', '/front-desk/kiosk/resume', kt, { staffCode: code1 }));
out.F2_resumeOwnStaff = sh(await call('resume', 'POST', '/front-desk/kiosk/resume', kt, { staffCode: code0 }));
out.F2_afterResume = (await call('k', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: rightCode })).status;

// F3: 15 wrong at once on a fresh tablet
sess = await call('fd-start', 'POST', `/schools/${S}/front-desk/sessions`, tSt0, { branchId: B0 });
kt = sess.body.sessionToken;
const burst = await Promise.all(Array.from({ length: 15 }, () => call('code-burst', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: wrong() })));
const sid = (await db.frontDeskSession.findFirst({ where: { schoolId: S }, orderBy: { createdAt: "desc" }, select: { wrongMemberCodeCount: true, lockedAt: true } }));
out.F3_burst15 = { codes: codesOf(burst), row: sid };

// F4: interleaving a known-good code (the guesser's own) never locks
await new Promise((r) => setTimeout(r, 61000));
sess = await call('fd-start', 'POST', `/schools/${S}/front-desk/sessions`, tSt0, { branchId: B0 });
kt = sess.body.sessionToken;
const inter = [];
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < 9; i++) inter.push((await call('code-inter', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: wrong() })).status);
  inter.push((await call('code-inter', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: rightCode })).status);
  if (round === 0) await new Promise((r) => setTimeout(r, 61000));
}
out.F4_interleave = { statuses: inter.join(','), locked: (await call('k', 'GET', '/front-desk/kiosk/session', kt)).body?.locked };

// F5: a member of another Branch typing their code at Branch 1's tablet
const other = C.students.find((s) => s.branch === C.branches[3] && s.home);
const oc = (await call('issue', 'GET', `/schools/${S}/students/${other.id}/check-in-code`, tOwner)).body.code;
sess = await call('fd-start', 'POST', `/schools/${S}/front-desk/sessions`, tSt0, { branchId: B0 });
kt = sess.body.sessionToken;
out.F5_otherBranchCode = sh(await call('code-other', 'POST', '/front-desk/kiosk/code-lookups', kt, { code: oc }));
fs.writeFileSync(new URL('./frontdesk-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
report();
await db.$disconnect();
