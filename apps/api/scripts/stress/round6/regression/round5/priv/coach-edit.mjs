// Can a coach (INSTRUCTOR only) PATCH a student's identity via the API? No-op write (same value).
import fs from 'fs';
import { db, call, tokenRca } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('../au/cast-au.json', import.meta.url)));
const coach = c.coaches.find((x) => x.b === 'syd');
const user = await db.user.findUnique({ where: { id: coach.id }, select: { id: true, email: true } });
const grants = await db.roleGrant.findMany({ where: { userId: coach.id, revokedAt: null }, select: { role: true, schoolId: true, branchId: true, franchiseId: true } });
console.log('coach grants', grants.map((g) => g.role + '@' + (g.branchId || 'school')));
const tok = tokenRca(user, grants);
const hb = await db.studentHomeBranch.findFirst({ where: { schoolId: c.schoolId, branchId: c.branches.syd }, select: { studentId: true } });
const p = await call('x', 'GET', `/schools/${c.schoolId}/students/${hb.studentId}/profile`, tok);
console.log('GET profile', p.status, p.body?.firstName, p.body?.dateOfBirth);
const w = await call('x', 'PATCH', `/schools/${c.schoolId}/students/${hb.studentId}/profile`, tok, { firstName: p.body.firstName });
console.log('PATCH same firstName as coach', w.status, JSON.stringify(w.body).slice(0, 160));
await db.$disconnect();
