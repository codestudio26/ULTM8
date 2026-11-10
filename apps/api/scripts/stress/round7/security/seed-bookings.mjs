// Harness shortcut for bookings-session.mjs: School A's members can't book
// without a plan in this world, so their bookings are written directly
// (the cursor test only needs rows to page through).
import { randomUUID } from 'crypto';
import { db, loadWorld } from './lib.mjs';
const w = loadWorld(); const A = w.schools.A;
for (const p of [A.people.adult1, A.people.parent]) for (const k of ['tomorrow1', 'small1', 'now1', 'past1']) {
  const c = await db.class.findUnique({ where: { id: A.classes[k] } });
  await db.booking.create({ data: { id: randomUUID(), studentId: p.id, classId: c.id, schoolId: A.id, branchId: c.branchId, status: 'UPCOMING' } });
}
console.log('seeded'); await db.$disconnect();
