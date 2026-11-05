import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const t = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', C.schoolId)]);
for (let i = 0; i < 4; i++) { const t0 = performance.now(); const r = await call('s', 'GET', `/schools/${C.schoolId}/staff`, t); console.log('staff', r.status, (performance.now() - t0) | 0, 'ms', r.bytes, 'B', (r.body?.items || r.body?.staff || []).length); }
// a small School for comparison
const small = await db.school.findFirst({ where: { name: { startsWith: 'R5 GB' } }, select: { id: true } });
const o = await db.roleGrant.findFirst({ where: { schoolId: small.id, role: 'SCHOOL_OWNER_MANAGER', isMainOwner: true }, select: { userId: true } });
const ts = tokenRca({ id: o.userId, email: 'x' }, [grant('SCHOOL_OWNER_MANAGER', small.id)]);
const n = await db.roleGrant.count({ where: { schoolId: small.id, role: 'STUDENT' } });
for (let i = 0; i < 2; i++) { const t0 = performance.now(); const r = await call('s', 'GET', `/schools/${small.id}/staff`, ts); console.log('small staff', n, 'students', r.status, (performance.now() - t0) | 0, 'ms'); }
await db.$disconnect();
