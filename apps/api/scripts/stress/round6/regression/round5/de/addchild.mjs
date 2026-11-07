// School B adds a child by hand, (1) with the email of a parent who only has an
// account through School A, (2) with a brand-new parent email. What does B learn,
// and is the child enrolled/consented before the parent agrees?
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { B } = cast;
const mother = await db.user.findUnique({ where: { id: cast.mother.id }, select: { email: true } });
const r1 = await call('x', 'POST', `/schools/${B.id}/students/add-child-manually`, B.owner.tok, { child: { firstName: 'Greta', surname: 'Groß-Öztürk', dateOfBirth: '2019-03-01', gender: 'FEMALE' }, guardian: { firstName: 'Sabine', surname: 'Groß', email: mother.email }, branchId: B.branches[0] });
console.log('(1) existing A-only parent email:', r1.status, JSON.stringify(r1.body).slice(0, 400));
const r1b = await call('x', 'POST', `/schools/${B.id}/students/add-child-manually`, B.owner.tok, { child: { firstName: 'Niemand', surname: 'Test', dateOfBirth: '2019-03-01', gender: null }, guardian: { firstName: 'X', surname: 'Y', email: mother.email.toUpperCase() }, branchId: B.branches[0] });
console.log('(1b) same email in capitals, other child:', r1b.status, JSON.stringify(r1b.body).slice(0, 300));
const email = `r5-de-${cast.run}-neuelternteil@stress.test`;
const r2 = await call('x', 'POST', `/schools/${B.id}/students/add-child-manually`, B.owner.tok, { child: { firstName: 'Lotte', surname: 'Neumann', dateOfBirth: '2016-02-29', gender: 'FEMALE' }, guardian: { firstName: 'Kerstin', surname: 'Neumann', email }, branchId: B.branches[0] });
console.log('(2) new parent email:', r2.status, JSON.stringify(r2.body).slice(0, 400));
const g = await db.user.findFirst({ where: { email }, select: { id: true, mustChangePasscode: true } });
if (g) {
  const links = await db.guardianLink.findMany({ where: { guardianId: g.id } });
  const consent = await db.consentRecord.findMany({ where: { guardianId: g.id } });
  const enrolled = await db.roleGrant.count({ where: { userId: { in: links.map((l) => l.studentId) }, schoolId: B.id, role: 'STUDENT', revokedAt: null } });
  console.log('(2) new guardian account mustChangePasscode', g.mustChangePasscode, 'links', links.length, 'consent records', consent.map((c) => `${c.tier}/${c.status}`).join(','), 'child enrolled at B', enrolled);
}
await db.$disconnect();
