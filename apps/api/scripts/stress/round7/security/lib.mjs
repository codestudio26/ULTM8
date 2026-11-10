// Round 7, tester S (security): shared helpers (copied from round 6 P).
//
// Builds on the launch-rehearsal helpers (../../../rehearsal/lib.mjs): real
// HTTP calls as each person after a real sign-in, fake Stripe/Twilio/R2 in
// the API process. Only difference: sign-up sends the Decision 444 "I agree"
// tick (acceptTerms), which the rehearsal's signUp predates.
//
//   API=http://localhost:3313/v1 DATABASE_URL=... REDIS_URL=... node <script>
import fs from 'fs';
import { call, must, signIn, stepUp, runJob, db, stripeWebhook, phoneFor, OTP, RUN } from '../../../rehearsal/lib.mjs';
export { call, must, signIn, stepUp, runJob, db, stripeWebhook, RUN };

export const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

let seq = 0;
/** register (with acceptTerms) → SMS code → sign in. */
export async function signUp({ first, last, dob = '1988-04-12', country = 'GB', language = 'en-GB', currency, acceptTerms = true, tag = '' }) {
  const email = `${first}.${last}${tag}.${RUN}.${seq++}@r7s.test`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  const phone = phoneFor(country);
  const passcode = '482913';
  await must(`register ${first}`, 'POST', '/auth/register', null, { email, phone, firstName: first, surname: last, passcode, passcodeConfirm: passcode, dateOfBirth: dob, language, currency, acceptTerms });
  await must(`otp ${first}`, 'POST', '/auth/otp/verify', null, { phone, code: OTP });
  const person = { email, phone, passcode, first, last };
  await signIn(person);
  person.id = JSON.parse(Buffer.from(person.tok.split('.')[1], 'base64url')).sub;
  return person;
}

// --- results ----------------------------------------------------------------
export const results = [];
/** expect: true = the check passed (behaviour is as the Decision says). */
export function rec(area, name, pass, evidence = '') {
  const row = { area, name, status: pass === null ? 'NOTE' : pass ? 'PASS' : 'FAIL', evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence).slice(0, 500) };
  results.push(row);
  console.log(`${row.status.padEnd(5)} [${area}] ${name}${row.evidence ? '  — ' + row.evidence : ''}`);
  return pass;
}
/** A refusal check: status must be one of `codes` (default 403/404). */
export function refused(area, name, r, codes = [403, 404]) {
  return rec(area, name, codes.includes(r.status), `${r.status} ${r.body?.error?.code ?? ''} ${(r.body?.error?.message ?? '').toString().slice(0, 140)}`);
}
export function saveResults(name) {
  fs.writeFileSync(new URL(`${name}-results.json`, OUT), JSON.stringify(results, null, 1));
  const by = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log(`\n${name}:`, JSON.stringify(by));
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
export const H = 3600e3;
export const D = 86400e3;

export function loadWorld() {
  return JSON.parse(fs.readFileSync(new URL('world.json', OUT), 'utf8'));
}
export function saveWorld(w) {
  fs.writeFileSync(new URL('world.json', OUT), JSON.stringify(w, null, 1));
}
/** Fresh tokens for everyone in the world (tokens live 15 min). */
export async function refreshAll(w) {
  for (const s of Object.values(w.schools)) {
    for (const p of Object.values(s.people)) await signIn(p);
  }
}
