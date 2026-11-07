// ST9: a cancelled class's notice reaches the booked child's parents (both, divorced) and nobody else.
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const owner = tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', sid)]);
const fam = A.guardians[0]; // family 0's first child also has the second (divorced) parent A.g2
const kid = fam.kids[0];
const kidB = A.students.find((s) => s.id === kid).b;
const g1 = tokenRca({ id: fam.id, email: 'g' }, []), g2 = tokenRca({ id: A.g2, email: 'g2' }, []);
const coach = A.coaches.find((c) => c.b === kidB);
const cls = await call('st9', 'POST', `/schools/${sid}/classes`, owner, { branchId: A.branches[kidB], instructorId: coach.id, title: 'Kids sparring (to cancel)', styles: [{ disciplineId: A.bjj, classType: 'Kids Sparring' }], startDate: new Date(Date.now() + 2 * 86400e3).toISOString(), endDate: new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString(), capacity: 10, membershipInclusion: true });
console.log('class', cls.status, cls.body?.id ?? JSON.stringify(cls.body).slice(0, 200));
const gb = await call('st9', 'POST', `/classes/${cls.body.id}/book`, g1, { studentId: kid });
console.log('parent books', gb.status, JSON.stringify(gb.body).slice(0, 160));
const can = await call('st9', 'POST', `/classes/${cls.body.id}/cancel`, owner, { reason: 'Coach at the State titles' });
console.log('cancel', can.status, JSON.stringify(can.body).slice(0, 160));
await new Promise((r) => setTimeout(r, 8000));
const find = async (t) => ((await call('n', 'GET', '/notifications/me', t)).body?.items ?? []).filter((n) => JSON.stringify(n).includes('Kids sparring'));
const other = A.guardians.find((g) => g.id !== fam.id && g.kids.length);
const kidN = await db.notification.findMany({ where: { OR: [{ userId: kid }, { userId: fam.id }, { userId: A.g2 }, { userId: other.id }], body: { contains: 'Kids sparring' } }, select: { userId: true, title: true, body: true } }).catch((e) => String(e).slice(0, 100));
console.log('parent 1', JSON.stringify(await find(g1)).slice(0, 300));
console.log('parent 2 (divorced)', JSON.stringify(await find(g2)).slice(0, 300));
console.log('other parent', JSON.stringify(await find(tokenRca({ id: other.id, email: 'x' }, []))).slice(0, 200));
console.log('db rows', JSON.stringify(kidN).slice(0, 600));
await db.$disconnect();
