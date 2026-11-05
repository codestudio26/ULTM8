// RLS directly with the app role (DATABASE_URL_APP): rows of School A (and C)
// about the shared member/child, as seen by B's people and by an A-only Guardian.
// Each count in its own transaction so one refused table doesn't hide the rest.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { A, B, C } = cast; const S = cast.shared.id, K = cast.kidAB;
const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
const T = [['Booking', 'studentId'], ['BookingAttendee', null], ['StudentNote', 'studentId'], ['Membership', 'studentId'], ['Transaction', 'studentId'], ['Charge', 'studentId'], ['WaiverSignature', 'studentId'], ['RoleGrant', 'userId'], ['StudentTag', 'studentId'], ['StudentCheckInCode', 'studentId'], ['StaffActivity', 'targetUserId'], ['Notification', 'userId'], ['StudentMedicalInfo', 'studentId'], ['StudentJoinDate', 'studentId'], ['StudentHomeBranch', 'studentId'], ['MemberFile', 'studentId'], ['StudentExportLog', null], ['NotificationBroadcast', null], ['Waiver', null]];
const count = async (uid, sql) => app.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${uid}'`);
  return Number((await tx.$queryRawUnsafe(sql))[0].n);
}).catch((e) => 'ERR ' + (e.message.match(/(permission denied[^\n"]*|column [^\n]*does not exist|relation [^\n]* does not exist)/)?.[0] ?? e.message.slice(-120)));
const res = {};
for (const [who, id] of [['B.owner', B.owner.id], ['B.staff', B.staff.id], ['B.instructor', B.instr[0]], ['mother(A-only)', cast.mother.id], ['A.owner(sanity)', A.owner.id]]) {
  const r = {};
  for (const [t, col] of T) {
    const who2 = col ? ` and "${col}" in ('${S}','${K}')` : '';
    r[t] = await count(id, `select count(*)::int n from "${t}" where "schoolId" in ('${A.id}','${C.id}')${who2}`);
  }
  r['User(aOnly member)'] = await count(id, `select count(*)::int n from "User" where id = '${cast.studentsA[3].id}'`);
  r['GuardianLink(kid)'] = await count(id, `select count(*)::int n from "GuardianLink" where "studentId" = '${K}'`);
  r['User(mother)'] = await count(id, `select count(*)::int n from "User" where id = '${cast.mother.id}'`);
  r['Class(A)'] = await count(id, `select count(*)::int n from "Class" where "schoolId" = '${A.id}'`);
  r['School(A)'] = await count(id, `select count(*)::int n from "School" where id = '${A.id}'`);
  res[who] = r;
}
console.table(res);
fs.writeFileSync(new URL('./rls-result.json', import.meta.url), JSON.stringify(res, null, 1));
await app.$disconnect();
