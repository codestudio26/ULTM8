// Round 6 adaptation (Decision 441 item 5): switch "Waiver must be signed before
// booking or check-in" off, through the owner's check-in rules page, at the
// round 5 School named by a cast file (node waiver-rule-off.mjs ng/ng-cast.json).
// The round 5 scripts were written when only a Class's own "needs a waiver" applied.
import fs from 'fs';
import { db, call, grant, tokenRca } from '../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(process.argv[2]));
const schoolId = c.schoolId ?? c.school?.id;
const owner = await db.roleGrant.findFirst({ where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, orderBy: [{ isMainOwner: 'desc' }, { grantedAt: 'asc' }], include: { user: true } });
const tok = tokenRca(owner.user, [grant('SCHOOL_OWNER_MANAGER', schoolId)]);
const g = await call('setup', 'GET', `/schools/${schoolId}/check-in-rules`, tok);
let p = await call('setup', 'PUT', `/schools/${schoolId}/check-in-rules`, tok, { ...g.body, requireWaiver: false });
if (p.body?.error?.code === 'CHECK_IN_CODE_DIGITS_LOCKED') p = await call('setup', 'PUT', `/schools/${schoolId}/check-in-rules`, tok, { ...g.body, requireWaiver: false, codeDigits: 6 });
console.log(process.argv[2], schoolId, 'waiver rule off:', p.status);
await db.$disconnect();
