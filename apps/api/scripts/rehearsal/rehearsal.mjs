// Launch rehearsal 1: the real journeys, end to end, for a UK School (cards
// through Stripe Connect, against the fake Stripe) and a Brazilian School
// (no card payments: Pix as a bank transfer or cash, confirmed by the School).
// See README.md for how to start the stack, and
// docs/handover/LAUNCH-REHEARSAL-1.md for the results.
//
//   ONLY=1,2,3   run only some journeys (setup always runs)
import { save, db, RUN } from './lib.mjs';
import { SCHOOLS } from './schools.mjs';
import { j1Setup } from './j1-setup.mjs';
import { j2Staff } from './j2-staff.mjs';
import { j3Members } from './j3-members.mjs';
import { j4Classes } from './j4-classes.mjs';
import { j5Delete } from './j5-delete.mjs';
import { j6Language } from './j6-language.mjs';
import { j7Tenancy } from './j7-tenancy.mjs';

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (n) => !only || only.has(String(n));
const ctx = { run: RUN };
console.log(`Launch rehearsal run ${RUN} against ${process.env.API || 'http://localhost:3317/v1'}\n`);

for (const cfg of SCHOOLS) {
  const s = (ctx[cfg.key] = { cfg });
  await j1Setup(s);
  if (want(2)) await j2Staff(s);
  if (want(3)) await j3Members(s);
  if (want(4)) await j4Classes(s);
  if (want(5)) await j5Delete(s);
}
if (want(6)) await j6Language(ctx);
if (want(7)) await j7Tenancy(ctx);

save(`results-${RUN}.json`);
// Ids the portal check (portal.mjs) reuses.
const fs = await import('fs');
const keep = Object.fromEntries(SCHOOLS.map((c) => [c.key, { schoolId: ctx[c.key].school?.id, owner: pick(ctx[c.key].owner), staff: pick(ctx[c.key].staff), adult: pick(ctx[c.key].adult) }]));
fs.writeFileSync(new URL(`./cast-${RUN}.json`, import.meta.url), JSON.stringify(keep, null, 1));
function pick(p) { return p ? { email: p.email, passcode: p.passcode, id: p.id } : null; }
await db.$disconnect();
process.exit(0);
