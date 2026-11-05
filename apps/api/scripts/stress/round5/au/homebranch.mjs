// Gives every seeded student a home Branch (StudentHomeBranch), which the student
// app's join flow sets and the seed skipped (as round4/world.mjs did).
import fs from 'fs';
import { db, randomUUID } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const r = await db.studentHomeBranch.createMany({ data: A.students.map((s) => ({ id: randomUUID(), schoolId: A.schoolId, studentId: s.id, branchId: A.branches[s.b], assignedById: A.owner })), skipDuplicates: true });
console.log(r);
await db.$disconnect();
