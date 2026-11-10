// Round 7 S: the world for the security attacks.
//   Franchise F1 (owner fo1): School A (GB) and School B (BR), both full casts.
//   Franchise F2 (owner fo2): School C (GB, full cast too: the "other business").
//   School D (GB, no Franchise): owner only, plus a member (strangers).
//   A plain stranger with no School at all.
// Every step through the real API (franchise create, join request, accept).
// Writes out/world.json. Run: node world7.mjs
import fs from 'fs';
import { must, signUp, signIn, db, saveWorld, loadWorld, refreshAll } from './lib.mjs';
import { buildSchool } from './world.mjs';

// Resumable: Schools already in out/world.json are kept.
let w = { run: process.env.RUN_ID, schools: {}, franchises: {}, extra: {} };
try { w = { franchises: {}, extra: {}, ...loadWorld() }; await refreshAll(w); } catch {}
for (const [k, cfg] of [['A', 'A'], ['B', 'B'], ['C', 'A']]) {
  if (w.schools[k]) continue;
  w.schools[k] = await buildSchool(k, cfg);
  saveWorld(w);
}
async function mkFranchise(key, schoolKeys) {
  const fo = await signUp({ first: 'Fran', last: `Owner${key}`, country: 'GB', language: 'en-GB', currency: 'GBP' });
  const f = await must('franchise', 'POST', '/franchises', fo.tok, { name: `R7S Franchise ${key} ${Date.now()}`, acceptAgreement: true });
  await signIn(fo);
  for (const sk of schoolKeys) {
    const s = w.schools[sk];
    const req = await must(`join req ${sk}`, 'POST', `/schools/${s.id}/join-franchise`, s.people.owner.tok, { franchiseId: f.id });
    await must(`accept ${sk}`, 'POST', `/franchises/${f.id}/join-requests/${req.id}/accept`, fo.tok, {});
  }
  w.franchises[key] = { id: f.id, owner: fo, schools: schoolKeys };
}
await mkFranchise('F1', ['A', 'B']);
await mkFranchise('F2', ['C']);
// School D: no Franchise, owner + a member.
const dOwner = await signUp({ first: 'Dora', last: 'OwnerD' });
const sd = await must('school D', 'POST', '/schools', dOwner.tok, { name: `R7S School D ${Date.now()}`, timezone: 'Europe/London', defaultCurrency: 'GBP', defaultLanguage: 'en-GB', postalAddress: { line1: '2 High St', city: 'London', postalCode: 'E1 6AN', country: 'GB' }, ranksToggle: true, acceptAgreement: true });
await signIn(dOwner);
const dMember = await signUp({ first: 'Dan', last: 'MemberD' });
await must('join D', 'POST', `/schools/${sd.id}/join`, dMember.tok, {});
await signIn(dMember);
w.extra.D = { id: sd.id, owner: dOwner, member: dMember };
w.extra.stranger = await signUp({ first: 'Stray', last: 'Nobody' });
saveWorld(w);
console.log('world built', Object.fromEntries(Object.entries(w.schools).map(([k, s]) => [k, s.id])), w.franchises.F1.id, w.franchises.F2.id);
await db.$disconnect();
