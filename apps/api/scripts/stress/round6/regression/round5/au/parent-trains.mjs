// A parent who also trains at the same School (STUDENT role there; no GUARDIAN
// grant, which nothing in the product creates — Decision 427 answer 2) books
// their child: as a Guardian (studentId) and through Kid Mode.
import fs from 'fs';
import { db, call, grant, tokenRca, randomUUID } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const kid = A.students.find((s) => s.tag === 'kid' && s.b === 'syd' && A.memberships[s.id] && !A.guardians.some((g) => g.kids[0] === s.id && g.kids.length > 1));
const mkParent = async (label, trains) => {
  const u = await db.user.create({ data: { id: randomUUID(), email: `r5-au-parent-${label}-${Date.now()}@stress.test`, firstName: 'Parent', surname: label, passcodeHash: 'x', dateOfBirth: new Date('1985-03-03'), phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'AUD' } });
  if (trains) {
    await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: sid, branchId: A.branches.syd } });
    await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: sid, studentId: u.id, branchId: A.branches.syd } });
  }
  await db.guardianLink.create({ data: { id: randomUUID(), guardianId: u.id, studentId: kid.id } });
  return u;
};
const cls = await db.class.findMany({ where: { schoolId: sid, branchId: A.branches.syd, startDate: { gt: new Date(Date.now() + 2 * 86400e3) }, cancelledAt: null, timetableSlotId: { not: null } }, orderBy: { startDate: 'asc' }, take: 6 });
for (const [label, trains, i] of [['plain', false, 0], ['trains', true, 2]]) {
  const p = await mkParent(label, trains);
  const grants = trains ? [grant('STUDENT', sid, A.branches.syd)] : [];
  const t = tokenRca(p, grants);
  const g = await call('pt', 'POST', `/classes/${cls[i].id}/book`, t, { studentId: kid.id });
  console.log(`${label.padEnd(7)} parent books child (Guardian path): ${g.status} ${JSON.stringify(g.body).slice(0, 160)}`);
  const del = await call('pt', 'POST', `/guardians/me/minors/${kid.id}/booking-delegation`, t, {});
  const km = await call('pt', 'POST', `/guardians/me/minors/${kid.id}/kid-mode-token`, t, {});
  const k = await call('pt', 'POST', `/classes/${cls[i + 1].id}/book`, km.body?.accessToken, { studentId: kid.id });
  console.log(`${label.padEnd(7)} Kid Mode books child: delegation ${del.status}, token ${km.status}, book ${k.status} ${JSON.stringify(k.body).slice(0, 160)}`);
  const w = await call('pt', 'POST', `/classes/${cls[i].id}/waitlist`, t, { studentId: kid.id });
  console.log(`${label.padEnd(7)} parent joins waitlist for child: ${w.status} ${JSON.stringify(w.body).slice(0, 120)}`);
}
await db.$disconnect();
