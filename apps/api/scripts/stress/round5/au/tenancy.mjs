// Round 5 AU: my people against other testers' Schools (reads only, plus writes that must be refused), and RLS with the app role.
import fs from 'fs';
import { db, call, grant, tokenRca, codes } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const others = await db.school.findMany({ where: { name: { startsWith: 'R5 ' }, NOT: { id: sid } }, select: { id: true, name: true } });
console.log('other R5 schools', others.length, others.map((o) => o.name).join(' | ').slice(0, 300));
const me = { owner: tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', sid)]) };
const coachT = tokenRca({ id: A.coaches[0].id, email: 'c' }, [grant('INSTRUCTOR', sid, A.branches.syd)]);
const studT = tokenRca({ id: A.students[20].id, email: 's' }, [grant('STUDENT', sid, A.branches[A.students[20].b])]);
const results = [];
let leaks = 0;
for (const o of others.slice(0, 12)) {
  const cls = await db.class.findFirst({ where: { schoolId: o.id, cancelledAt: null, startDate: { gt: new Date() } }, select: { id: true } });
  const stu = await db.roleGrant.findFirst({ where: { schoolId: o.id, role: 'STUDENT', revokedAt: null }, select: { userId: true } });
  // My owner's token claiming owner at their School (a forged claim: the server must check the database).
  const forged = tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', o.id)]);
  const probes = [
    ['GET', `/schools/${o.id}/students`, me.owner], ['GET', `/schools/${o.id}/students`, forged], ['GET', `/schools/${o.id}/staff`, forged],
    ['GET', `/schools/${o.id}/staff/activity`, forged], ['GET', `/schools/${o.id}/students/export`, forged], ['GET', `/schools/${o.id}/transactions`, forged],
    ...(cls ? [['GET', `/classes/${cls.id}/bookings`, coachT], ['POST', `/classes/${cls.id}/book`, studT, {}], ['POST', `/classes/${cls.id}/attendance-scan`, coachT, { studentId: A.students[20].id }], ['GET', `/classes/${cls.id}/qr-token`, coachT], ['POST', `/classes/${cls.id}/cancel`, forged, { reason: 'x' }]] : []),
    ...(stu ? [['GET', `/students/${stu.userId}/bookings`, forged], ['POST', `/schools/${o.id}/staff/${stu.userId}/pause`, forged, {}], ['GET', `/guardians/me/minors/${stu.userId}/bookings`, studT]] : []),
    ['PUT', `/schools/${o.id}/staff/settings`, forged, { mustAcceptFirst: true }], ['POST', `/schools/${o.id}/coach-invites`, forged, { email: 'r5-au-x@stress.test', role: 'INSTRUCTOR' }],
  ];
  for (const [m, p, t, b] of probes) {
    const r = await call('xt', m, p, t, b);
    results.push(r.status);
    const body = JSON.stringify(r.body);
    if (r.status < 300) { leaks++; console.log('ALLOWED', o.name, m, p, r.status, body.slice(0, 160)); }
  }
}
console.log('codes', JSON.stringify(codes(results.map((s) => ({ status: s })))), 'allowed', leaks);
// My School as seen by the app role with another School's user context.
const otherUser = others[0] ? await db.roleGrant.findFirst({ where: { schoolId: others[0].id, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { userId: true } }) : null;
if (otherUser) {
  const { createRequire } = await import('module');
  const require = createRequire(new URL('../../../../package.json', import.meta.url));
  const { PrismaClient } = require('@prisma/client');
  const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
  const rows = await app.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select set_config('app.current_user_id', '${otherUser.userId}', true)`);
    return Promise.all([
      tx.$queryRawUnsafe(`select count(*)::int n from "User" u join "RoleGrant" g on g."userId"=u.id where g."schoolId"='${sid}'`),
      tx.$queryRawUnsafe(`select count(*)::int n from "Booking" where "schoolId"='${sid}'`),
      tx.$queryRawUnsafe(`select count(*)::int n from "StaffActivity" where "schoolId"='${sid}'`).catch((e) => String(e).slice(0, 80)),
      tx.$queryRawUnsafe(`select count(*)::int n from "WaiverSignature" ws join "Waiver" w on w.id=ws."waiverId" where w."schoolId"='${sid}'`),
    ]);
  });
  console.log('RLS as another School\'s owner: my users/bookings/activity/signatures', JSON.stringify(rows));
  await app.$disconnect();
}
await db.$disconnect();
