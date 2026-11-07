import { cast, call, db } from '../round3/common.mjs';
const X = cast.schools[Number(process.env.I ?? 26)];
const d = await call('d', 'POST', `/schools/${X.id}/disciplines`, X.owner.tok, { name: `Probe ${Date.now()}`, classTypesOffered: [] });
const p = await call('p', 'POST', `/schools/${X.id}/membership-plans`, X.owner.tok, { type: 'CLASS_PACK', title: `probe ${Date.now()}`, price: 1000, classesIncluded: 5, disciplineIds: [d.body.id] });
console.log(p.status, JSON.stringify(p.body));
await db.$disconnect();
