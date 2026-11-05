// Can the owner merge the two Niamh Kelly records the second parent's invite made?
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./gb-cast.json', import.meta.url)));
const t = tokenRca(C.users.owner, [grant('SCHOOL_OWNER_MANAGER', C.schoolA)]);
const rows = await db.user.findMany({ where: { firstName: 'Niamh', surname: 'Kelly', roleGrants: { some: { schoolId: C.schoolA } } }, select: { id: true } });
const [a, b] = rows.map((r) => r.id).sort((x, y) => (x === C.users.niamh.id ? -1 : 1));
console.log('records', a, b);
const p = await call('merge preview', 'GET', `/schools/${C.schoolA}/students/${a}/merge/preview?duplicateId=${b}`, t);
console.log('preview', p.status, JSON.stringify(p.body).slice(0, 600));
const m = await call('merge', 'POST', `/schools/${C.schoolA}/students/${a}/merge`, t, { duplicateId: b });
console.log('merge', m.status, JSON.stringify(m.body).slice(0, 400));
await db.$disconnect(); process.exit(0);
