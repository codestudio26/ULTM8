// TIME-1 regression check on a clean School: a Windows zone name is refused on the
// School and the Branch, and the class generator still runs for every School.
import { db, call, token, grant, randomUUID, Queue } from '../booking-schedule/lib.mjs';
const school = await db.school.create({ data: { id: randomUUID(), name: `R6 TIME-1 ${Date.now()}`, timezone: 'America/Denver' } });
const branch = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
const owner = await db.user.create({ data: { id: randomUUID(), email: `r6-t1-${randomUUID().slice(0, 8)}@stress.test`, firstName: 'O', surname: 'T1', passcodeHash: 'x', dateOfBirth: new Date('1980-01-01') } });
await db.roleGrant.create({ data: { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true } });
const tok = token(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
const out = {};
for (const tz of ['Mountain Standard Time', 'US/Mountain', 'EST', 'Mars/Olympus', 'America/Denver']) {
  out[`school ${tz}`] = (await call('t1', 'PATCH', `/schools/${school.id}`, tok, { timezone: tz })).status;
  out[`branch ${tz}`] = (await call('t1', 'PATCH', `/branches/${branch.id}`, tok, { timezone: tz })).status;
}
const bad = await db.school.count({ where: { timezone: { contains: ' ' } } });
const q = new Queue('class-occurrence-generation', { connection: { url: process.env.REDIS_URL } });
const job = await q.add('run', {});
let state; for (let i = 0; i < 120; i++) { state = await job.getState(); if (state === 'completed' || state === 'failed') break; await new Promise((r) => setTimeout(r, 1000)); }
console.log(JSON.stringify(out), `Schools with a space in their zone: ${bad}; generator job: ${state}`);
await q.close(); await db.$disconnect();
