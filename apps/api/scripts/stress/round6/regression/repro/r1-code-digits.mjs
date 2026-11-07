// R-1 repro on a clean School: a School that has just grown past 500 students
// still reads codeDigits 4 from GET /check-in-rules, and PUTting back what it
// read (the portal's Save, any change) is refused with CHECK_IN_CODE_DIGITS_LOCKED.
import { db, call, token, grant, randomUUID } from '../booking-schedule/lib.mjs';
const school = await db.school.create({ data: { id: randomUUID(), name: `R6 R-1 ${Date.now()}` } });
const owner = await db.user.create({ data: { id: randomUUID(), email: `r6-r1-o-${randomUUID().slice(0, 8)}@stress.test`, firstName: 'O', surname: 'R1', passcodeHash: 'x', dateOfBirth: new Date('1980-01-01') } });
await db.roleGrant.create({ data: { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true } });
const tok = token(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
const mk = async (n) => {
  const us = Array.from({ length: n }, () => ({ id: randomUUID(), email: `r6-r1-${randomUUID()}@stress.test`, firstName: 'S', surname: 'R1', passcodeHash: 'x', dateOfBirth: new Date('1995-01-01') }));
  await db.user.createMany({ data: us });
  await db.roleGrant.createMany({ data: us.map((u) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id })) });
};
await mk(499);
const g1 = await call('r1', 'GET', `/schools/${school.id}/check-in-rules`, tok);
const p1 = await call('r1', 'PUT', `/schools/${school.id}/check-in-rules`, tok, { ...g1.body, requireWaiver: false });
console.log('499 students: GET codeDigits', g1.body.codeDigits, '→ PUT', p1.status);
await mk(2); // the School grows past 500 (e.g. a sign-up day)
const g2 = await call('r1', 'GET', `/schools/${school.id}/check-in-rules`, tok);
const p2 = await call('r1', 'PUT', `/schools/${school.id}/check-in-rules`, tok, { ...g2.body, requireWaiver: true });
console.log('501 students: GET codeDigits', g2.body.codeDigits, '→ PUT of what GET returned:', p2.status, JSON.stringify(p2.body));
await db.$disconnect();
