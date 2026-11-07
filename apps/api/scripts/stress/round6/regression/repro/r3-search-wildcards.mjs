// R-3 repro on a clean School: does the roster search treat "%" and "_" as wildcards?
import { db, call, token, grant, randomUUID } from '../booking-schedule/lib.mjs';
const school = await db.school.create({ data: { id: randomUUID(), name: `R6 R-3 ${Date.now()}` } });
const owner = await db.user.create({ data: { id: randomUUID(), email: `r6-r3-o-${randomUUID().slice(0, 8)}@stress.test`, firstName: 'Owner', surname: 'R3', passcodeHash: 'x', dateOfBirth: new Date('1980-01-01') } });
await db.roleGrant.create({ data: { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true } });
const tok = token(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
const names = [['Ana', 'Silva'], ['Bruno', 'Costa'], ['Chloé', "O'Brien"], ['Dev', 'Patel']];
for (const [f, s] of names) {
  const u = await db.user.create({ data: { id: randomUUID(), email: `r6-r3-${randomUUID()}@stress.test`, firstName: f, surname: s, passcodeHash: 'x', dateOfBirth: new Date('1995-01-01') } });
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id } });
}
const out = {};
for (const q of ['%', '_', '%a%', 'a_a', 'Silva', 'zz']) {
  const r = await call('r3', 'GET', `/schools/${school.id}/students?search=${encodeURIComponent(q)}`, tok);
  out[q] = `${r.status} ${r.body?.items?.length ?? JSON.stringify(r.body).slice(0, 80)}`;
}
console.log('4 students, none with % or _ in their name:', JSON.stringify(out));
await db.$disconnect();
