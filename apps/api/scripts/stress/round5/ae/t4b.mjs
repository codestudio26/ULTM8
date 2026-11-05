import { C, tk, call, S, short, db } from './lib.mjs';
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const others = await db.school.findMany({ where: { name: { startsWith: 'R5 ' }, NOT: { name: { startsWith: 'R5 AE' } } }, select: { id: true, name: true }, take: 6 });
for (const o of others) for (const p of [`/schools/${o.id}`, `/schools/${o.id}/waivers`, `/schools/${o.id}/timetable`]) { const r = await call('x', 'GET', p, tOwner); if (r.status < 300) console.log(o.name, p.split('/').pop(), r.status, short(r.body, 400)); }
await db.$disconnect();
