import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const c = A.coaches.find((x) => x.name === process.env.WHO || 'Bruno');
const t = tokenRca({ id: c.id, email: 'x' }, [grant('INSTRUCTOR', A.schoolId, A.branches[c.b])]);
const r = await call('p', process.env.M || 'GET', process.env.P.replaceAll('{sid}', A.schoolId), t);
console.log(r.status, JSON.stringify(r.body).slice(0, +(process.env.N || 800)));
await db.$disconnect();
