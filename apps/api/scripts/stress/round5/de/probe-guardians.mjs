// What School B's owner sees about the shared child's A-only Guardian (mother).
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { B } = cast; const K = cast.kidAB;
const g = await call('g', 'GET', `/schools/${B.id}/students/${K}/guardians`, B.owner.tok);
console.log('GET /schools/B/students/K/guardians ->', g.status, JSON.stringify(g.body));
const e = await call('e', 'GET', `/schools/${B.id}/students/export`, B.owner.tok);
const row = (e.body.items || e.body.rows || []).find((r) => r.id === K);
console.log('export row for K ->', JSON.stringify(row));
const p = await call('p', 'GET', `/schools/${B.id}/students/${K}/profile`, B.owner.tok);
console.log('profile K ->', p.status, JSON.stringify(p.body).slice(0, 600));
const ps = await call('p', 'GET', `/schools/${B.id}/students/${cast.shared.id}/profile`, B.owner.tok);
console.log('profile S ->', ps.status, JSON.stringify(ps.body).slice(0, 900));
await db.$disconnect();
