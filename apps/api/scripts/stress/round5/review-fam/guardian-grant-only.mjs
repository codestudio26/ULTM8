// Harness check: a plain parent who holds ONLY a seeded GUARDIAN RoleGrant (as round 4 world.mjs gave).
import { db, call, grant, tokenRca, randomUUID } from '../../round4/common.mjs';
const S = process.env.SCHOOL; const tag = Date.now();
const kid = await db.user.findFirst({ where: { email: { startsWith: 'r5-fam-kid-' }, roleGrants: { some: { schoolId: S } } } });
const p = await db.user.create({ data: { id: randomUUID(), email: `r5-fam-gonly-${tag}@stress.test`, firstName: 'Fam', surname: 'gonly', passcodeHash: 'x', dateOfBirth: new Date('1980-01-01'), phoneVerifiedAt: new Date() } });
await db.guardianLink.create({ data: { id: randomUUID(), guardianId: p.id, studentId: kid.id } });
const cls = await db.class.findFirst({ where: { schoolId: S, title: 'Book plain' } });
const before = await call('x', 'POST', `/classes/${cls.id}/waitlist`, tokenRca(p, []), { studentId: kid.id });
await db.roleGrant.create({ data: { id: randomUUID(), userId: p.id, role: 'GUARDIAN', schoolId: S } });
const after = await call('x', 'POST', `/classes/${cls.id}/waitlist`, tokenRca(p, [grant('GUARDIAN', S)]), { studentId: kid.id });
console.log('no grant:', before.status, JSON.stringify(before.body).slice(0, 100));
console.log('GUARDIAN grant:', after.status, JSON.stringify(after.body).slice(0, 110));
await db.$disconnect();
