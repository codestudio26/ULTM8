import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const owners = await db.roleGrant.findMany({ where: { schoolId: sid, role: 'SCHOOL_OWNER_MANAGER' }, select: { id: true, userId: true, isMainOwner: true, revokedAt: true, grantedAt: true } });
console.log(owners, A.owner, A.coOwner);
const login = async (id) => { const u = await db.user.findUnique({ where: { id } }); return (await call('l', 'POST', '/auth/login', null, { email: u.email, passcode: '246813' })).body.accessToken; };
for (const g of owners.filter((o) => !o.revokedAt && o.userId !== A.owner && o.userId !== A.coOwner)) {
  const t = await login(g.userId);
  const r = await call('x', 'DELETE', `/users/${g.userId}/role-grants/${g.id}`, t);
  console.log('self-remove', r.status, JSON.stringify(r.body));
}
await db.$disconnect();
