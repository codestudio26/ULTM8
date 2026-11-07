// Round 6: coach-edit.mjs on a student given a home Branch first (the au seed only puts
// the Branch on the STUDENT grant, which the product never reads as a home Branch).
import fs from 'fs';
import { db, randomUUID } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('../au/cast-au.json', import.meta.url)));
const g = await db.roleGrant.findFirst({ where: { schoolId: c.schoolId, branchId: c.branches.syd, role: 'STUDENT', revokedAt: null }, select: { userId: true } });
await db.studentHomeBranch.upsert({ where: { schoolId_studentId: { schoolId: c.schoolId, studentId: g.userId } }, create: { id: randomUUID(), schoolId: c.schoolId, studentId: g.userId, branchId: c.branches.syd }, update: { branchId: c.branches.syd } });
console.log('home branch set for', g.userId);
await db.$disconnect();
