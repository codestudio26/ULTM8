import fs from 'fs';
import { db, call } from './lib.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast.json', import.meta.url)));
const now = Date.now();
for (const [nClasses, perClass, cap] of [[1, 40, 20], [1, 100, 30], [5, 40, 20], [10, 40, 20]]) {
  const picks = cast.schools.filter((s) => s.branches.length === 1).slice(0, nClasses);
  const classes = await Promise.all(picks.map(async (s) => (await call('b:mk', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branches[0], title: 'Burst', styles: [{ disciplineId: s.disciplineId, classType: s.classType }], startDate: new Date(now + 3600e3).toISOString(), endDate: new Date(now + 7200e3).toISOString(), capacity: cap })).body.id));
  const t0 = performance.now();
  const rs = (await Promise.all(picks.map((s, i) => Promise.all(s.students.filter((x) => x.kind === 'sub' && x.branch === s.branches[0]).slice(150, 150 + perClass).map(async (st) => { const a = performance.now(); const r = await call('b:book', 'POST', `/classes/${classes[i]}/book`, st.tok, {}); return { s: r.status, ms: performance.now() - a }; }))))).flat();
  const filled = await Promise.all(classes.map((c) => db.booking.count({ where: { classId: c, status: 'UPCOMING' } })));
  const c = {}; rs.forEach((r) => (c[r.s] = (c[r.s] || 0) + 1));
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`${nClasses} class(es) × ${perClass} bookers, ${cap} seats: filled ${filled.join(',')}; codes ${JSON.stringify(c)}; p50 ${ms[ms.length >> 1] | 0} ms, max ${ms[ms.length - 1] | 0} ms, wall ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
await db.$disconnect();
