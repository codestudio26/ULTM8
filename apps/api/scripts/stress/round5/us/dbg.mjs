import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const b = await db.booking.findFirst({ where: { class: { title: 'WL race 1' }, status: 'UPCOMING' }, include: { student: true, class: true } });
const t = tokenRca(b.student, [grant('STUDENT', b.schoolId, b.branchId)]);
console.log(await call('c', 'PATCH', `/bookings/${b.id}/cancel`, t, {}));
process.exit(0);
