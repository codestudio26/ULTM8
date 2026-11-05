// The product never writes GUARDIAN RoleGrants (Decision 92/270: a Guardian holds none), so remove the ones
// round 4's world shape gave, and re-sign the Guardian tokens without one.
import fs from 'fs';
import { db, tokenRca, grant } from '../../round4/common.mjs';
const p = new URL('./cast-br.json', import.meta.url);
const C = JSON.parse(fs.readFileSync(p));
const d = await db.roleGrant.deleteMany({ where: { schoolId: C.S, role: 'GUARDIAN' } });
const u = async (id) => db.user.findUnique({ where: { id } });
for (const f of C.families) f.tok = tokenRca(await u(f.g), []);
C.big.g2tok = tokenRca(await u(C.big.g2), []);
C.big.g1tok = tokenRca(await u(C.big.g1), [grant('STUDENT', C.S, C.branches.SP)]);
C.coachGuardianTok = tokenRca(await u(C.users.guardianCoach), [grant('INSTRUCTOR', C.S, C.branches.SP)]);
fs.writeFileSync(p, JSON.stringify(C));
console.log('removed GUARDIAN grants', d.count);
await db.$disconnect();
