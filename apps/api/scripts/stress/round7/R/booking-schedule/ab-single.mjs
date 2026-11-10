// A/B helper (round 6): 150 bookings one at a time (no contention) and the SQL
// statements Postgres ran for them (pg_stat_statements), per booking.
import fs from 'fs';
import { db, call, report } from './lib.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast.json', import.meta.url)));
const s = cast.schools[0];
const now = Date.now();
const cls = (await call('ab:mk', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branches[0], instructorId: s.instructor.id, title: 'AB single', styles: [{ disciplineId: s.disciplineId, classType: s.classType }], startDate: new Date(now + 3 * 3600e3).toISOString(), endDate: new Date(now + 4 * 3600e3).toISOString(), membershipInclusion: true, capacity: 400 })).body.id;
const subs = s.students.filter((x) => x.kind === 'sub' && x.branch === s.branches[0]).slice(200, 350);
await db.$executeRawUnsafe('SELECT pg_stat_statements_reset()');
for (const st of subs) await call('ab:single', 'POST', `/classes/${cls}/book`, st.tok, {});
const [row] = await db.$queryRawUnsafe(`SELECT sum(calls)::int calls, round(sum(total_exec_time))::int ms FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'`);
const top = await db.$queryRawUnsafe(`SELECT calls::int, round(total_exec_time)::int ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 140) q FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 12`);
console.log(`${subs.length} bookings: ${(row.calls / subs.length).toFixed(1)} SQL statements and ${(row.ms / subs.length).toFixed(1)} ms of SQL each (all API traffic in the window)`);
console.table(top);
report(['ab:single']);
await db.$disconnect();
