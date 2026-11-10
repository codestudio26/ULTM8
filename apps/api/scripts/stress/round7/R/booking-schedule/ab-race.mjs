// A/B helper (round 6): load.mjs's capacity race on its own, repeated ROUNDS times
// on fresh tiny classes, then a 400-booker burst. Run on the same machine against
// two builds back to back. Needs a seeded cast (N_SCHOOLS=10 node seed.mjs).
import fs from 'fs';
import { db, call, report } from './lib.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast.json', import.meta.url)));
const ROUNDS = Number(process.env.ROUNDS || 3);
const now = Date.now();
const mk = async (s, cap) => (await call('ab:mk', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branches[0], instructorId: s.instructor.id, title: `AB ${cap}`, styles: [{ disciplineId: s.disciplineId, classType: s.classType }], startDate: new Date(now + 3600e3).toISOString(), endDate: new Date(now + 7200e3).toISOString(), membershipInclusion: true, capacity: cap })).body.id;
let bad = 0; const res = {};
for (let r = 0; r < ROUNDS; r++) {
  await Promise.all(cast.schools.map(async (s) => {
    const subs = s.students.filter((x) => x.kind === 'sub' && x.branch === s.branches[0]);
    const a = await mk(s, 10), b = await mk(s, 3);
    const off = r * 50;
    const rs = await Promise.all([...subs.slice(off, off + 30).map((st) => call('ab:race', 'POST', `/classes/${a}/book`, st.tok, {})), ...subs.slice(off + 30, off + 50).map((st) => call('ab:race', 'POST', `/classes/${b}/book`, st.tok, {}))]);
    rs.forEach((x) => { res[x.status] = (res[x.status] || 0) + 1; if (x.status >= 500 && !globalThis.sample) globalThis.sample = x.body; });
    const [na, nb] = await Promise.all([a, b].map((id) => db.booking.count({ where: { classId: id, status: 'UPCOMING' } })));
    if (na !== 10 || nb !== 3) bad++;
  }));
}
console.log(`race: ${ROUNDS} rounds × ${cast.schools.length} Schools × (30→10, 20→3): codes ${JSON.stringify(res)}; classes not exactly full: ${bad}`);
if (globalThis.sample) console.log('a 5xx body:', JSON.stringify(globalThis.sample));
report(['ab:race']);
await db.$disconnect();
