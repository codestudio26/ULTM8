// Round 6: PRIV-1 after the purge, with a fresh sign-in token (after-purge.mjs's
// tokens are refused with ROLES_CHANGED, as a real old session would be).
import fs from 'fs';
import { db, call, tokenRca } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { C } = cast; const S = cast.shared.id;
for (const who of ['owner', 'staff']) {
  const id = C[who].id;
  const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  const grants = await db.roleGrant.findMany({ where: { userId: id, revokedAt: null }, select: { role: true, schoolId: true, branchId: true, franchiseId: true } });
  const tok = tokenRca(user, grants);
  for (const p of [`/schools/${C.id}/students`, `/schools/${C.id}/students/export`, `/schools/${C.id}/students/${S}/profile`, `/schools/${C.id}/students/${cast.kidC}/guardians`]) {
    const r = await call('x', 'GET', p, tok);
    const txt = JSON.stringify(r.body);
    console.log(`C.${who} (live grants: ${grants.filter((g) => g.schoolId === C.id).map((g) => g.role).join(',') || 'none'})`, 'GET', p.replace(C.id, '{C}').replace(S, '{S}').replace(cast.kidC, '{kidC}'), r.status, `items=${r.body?.items?.length ?? '-'}`, /@|dateOfBirth"\s*:\s*"\d|phone"\s*:\s*"\+/.test(txt) ? 'CONTAINS email/phone/DOB' : 'no email/phone/DOB', txt.slice(0, 160));
  }
}
await db.$disconnect();
