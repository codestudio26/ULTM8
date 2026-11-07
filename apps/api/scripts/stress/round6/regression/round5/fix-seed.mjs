// Round 6 adaptation, run once after the round 5 seeds: make the seeded families
// look like ones the product makes.
//  - no GUARDIAN role grants (the product never makes one; round 5 harness note);
//  - each Guardian link with no consent record at all gets an ACTIVE BASELINE one,
//    as the parent's consent tick when adding a child gives (Decision 430 item 9
//    refuses a child's booking without it). Links with a withdrawn record are left.
import { db, randomUUID } from '../round4/common.mjs';
const g = await db.roleGrant.deleteMany({ where: { role: 'GUARDIAN' } });
const links = await db.guardianLink.findMany({ where: { revokedAt: null }, select: { guardianId: true, studentId: true } });
const have = new Set((await db.consentRecord.findMany({ where: { tier: 'BASELINE' }, select: { guardianId: true, studentId: true } })).map((r) => `${r.guardianId}|${r.studentId}`));
const add = links.filter((l) => !have.has(`${l.guardianId}|${l.studentId}`)).map((l) => ({ id: randomUUID(), guardianId: l.guardianId, studentId: l.studentId, tier: 'BASELINE', policyVersion: 'unpublished' }));
for (let i = 0; i < add.length; i += 1000) await db.consentRecord.createMany({ data: add.slice(i, i + 1000), skipDuplicates: true });
console.log(`GUARDIAN grants removed: ${g.count}; BASELINE consent added to ${add.length} of ${links.length} links`);
await db.$disconnect();
