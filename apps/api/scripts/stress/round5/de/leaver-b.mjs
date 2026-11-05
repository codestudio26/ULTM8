// The shared member leaves School B (B's owner revokes her). Afterwards she
// updates her own profile. What does School B still see, and is A unaffected?
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { A, B } = cast; const S = cast.shared.id;
const grants = await call('g', 'GET', `/users/${S}/role-grants`, B.owner.tok);
const list = grants.body?.items ?? grants.body;
console.log('B owner lists the member\'s role grants:', grants.status, JSON.stringify(list.map((g) => [g.role, g.schoolId === A.id ? 'A' : g.schoolId === B.id ? 'B' : g.schoolId === cast.C.id ? 'C' : g.schoolId])));
const g = list.find((x) => x.role === 'STUDENT' && x.schoolId === B.id);
const rv = await call('r', 'DELETE', `/users/${S}/role-grants/${g.id}`, B.owner.tok);
console.log('revoke at B', rv.status, 'medical B left', await db.studentMedicalInfo.count({ where: { studentId: S, schoolId: B.id } }), 'medical A left', await db.studentMedicalInfo.count({ where: { studentId: S, schoolId: A.id } }));
const upd = await call('u', 'PATCH', '/users/me', cast.shared.tok, { emergencyContactName: 'NEW-AFTER-LEAVING Mutter', secondaryEmail: 'neu-nach-austritt@stress.test', weightCategory: '-57kg' });
console.log('member updates own profile after leaving B', upd.status, JSON.stringify(upd.body).slice(0, 120));
for (const p of [`/schools/${B.id}/students/${S}/profile`, `/schools/${B.id}/students?status=ALL&q=Br%C3%BCckner`, `/schools/${B.id}/students/export?filter=ALL`, `/schools/${B.id}/students/${S}/notes`]) {
  const r = await call('x', 'GET', p, B.owner.tok);
  const t = JSON.stringify(r.body);
  console.log('B after she left:', p.replace(B.id, '{B}').replace(S, '{S}'), r.status, /NEW-AFTER-LEAVING|neu-nach-austritt|-57kg/.test(t) ? 'SEES HER NEW DATA' : '', t.slice(0, 200));
}
await db.$disconnect();
