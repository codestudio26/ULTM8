// Round 5 US: the School's default 24 h refund cut-off, for a student who
// cancels vs a student the School removes, both 3 h before class.
//   CAST=../empty-cast.json node leaving.mjs
import fs from 'fs';
import { db, call, grant, tokenRca, checks } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-us.json', import.meta.url)));
const S = C.schoolId;
const { ok, save } = checks('leaving');
const owner = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const ny = C.branches.find((b) => b.name === 'New York');
const instr = C.instructors.find((i) => i.branch === ny.id).id;
const school = await db.school.findUnique({ where: { id: S }, select: { defaultRefundCutoffHours: true } });
// Two pack holders (10 credits) at New York.
const packs = await db.membership.findMany({ where: { schoolId: S, classesRemaining: 10, student: { roleGrants: { some: { schoolId: S, branchId: ny.id, role: 'STUDENT', revokedAt: null } } } }, take: 2, include: { student: true } });
const cls = await call('class', 'POST', `/schools/${S}/classes`, owner, { branchId: ny.id, instructorId: instr, title: 'Cut-off check (3 h away)', styles: C.styles, startDate: new Date(Date.now() + 3 * 3600e3).toISOString(), endDate: new Date(Date.now() + 4 * 3600e3).toISOString(), capacity: 10, membershipInclusion: true });
const [p1, p2] = packs;
const tok = (m) => tokenRca(m.student, [grant('STUDENT', S, ny.id)]);
const b1 = await call('book', 'POST', `/classes/${cls.body.id}/book`, tok(p1), {});
const b2 = await call('book', 'POST', `/classes/${cls.body.id}/book`, tok(p2), {});
// Staff cancels p1's booking; the School removes p2.
const c1 = await call('cancel', 'PATCH', `/bookings/${b1.body.id}/cancel`, owner, {});
const g2 = await db.roleGrant.findFirst({ where: { userId: p2.studentId, schoolId: S, role: 'STUDENT', revokedAt: null } });
const rv = await call('revoke', 'DELETE', `/users/${p2.studentId}/role-grants/${g2.id}`, owner);
const after = await db.booking.findMany({ where: { id: { in: [b1.body.id, b2.body.id] } }, select: { id: true, status: true, refundResolution: true } });
const m = await db.membership.findMany({ where: { id: { in: [p1.id, p2.id] } }, select: { id: true, classesRemaining: true } });
const res = { cutoffHours: school.defaultRefundCutoffHours, book: [b1.status, b2.status], staffCancel: c1.status, revoke: rv.status,
  staffCancelled: { resolution: after.find((x) => x.id === b1.body.id)?.refundResolution, credits: m.find((x) => x.id === p1.id)?.classesRemaining },
  removed: { resolution: after.find((x) => x.id === b2.body.id)?.refundResolution, credits: m.find((x) => x.id === p2.id)?.classesRemaining } };
console.log(JSON.stringify(res, null, 1));
ok('LV1 removed student and staff-cancelled student get the same credit rule inside the 24 h cut-off', res.staffCancelled.resolution === res.removed.resolution, JSON.stringify(res));
save();
await db.$disconnect();
process.exit(0);
