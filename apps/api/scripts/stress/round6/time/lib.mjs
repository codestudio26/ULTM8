// Round 6, tester T (time, scale, races): shared helpers.
// Builds on ../../../rehearsal/lib.mjs (call/must with 429 retry, runJob,
// stripeWebhook, db). Adds: sign-up with the Decision 444 "I agree" tick,
// unique phones for many people, findings bookkeeping that is appended to a
// JSONL file after every check (the container can restart at any time).
//
// Env: API, DATABASE_URL, REDIS_URL, STRIPE_WEBHOOK_SECRET, FAKE_STRIPE_PORT,
// T_OUT (folder for results, default ./out).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
export { call, must, runJob, stripeWebhook, db, OTP, PrismaClient, days, isoDay } from '../../../rehearsal/lib.mjs';
import { call, must, OTP } from '../../../rehearsal/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.T_OUT || path.join(here, 'out');
fs.mkdirSync(OUT, { recursive: true });
export const FAKE = `http://localhost:${process.env.FAKE_STRIPE_PORT || 12114}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- results, appended as we go -------------------------------------------
let section = '';
export function sectionOf(name) { section = name; console.log(`\n=== ${name}`); }
export function record(step, status, evidence) {
  const row = { at: new Date().toISOString(), section, step, status, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence)?.slice(0, 1500) };
  fs.appendFileSync(path.join(OUT, 'results.jsonl'), JSON.stringify(row) + '\n');
  console.log(`${status.padEnd(5)} ${step}${row.evidence ? '  — ' + row.evidence : ''}`);
  return status === 'PASS';
}
export const ok = (step, cond, ev) => record(step, cond ? 'PASS' : 'FAIL', ev);
export const note = (step, ev) => record(step, 'NOTE', ev);

// --- cast (ids + sign-ins), saved after each School -------------------------
export const CAST_FILE = path.join(OUT, 'cast.json');
export function loadCast() { try { return JSON.parse(fs.readFileSync(CAST_FILE, 'utf8')); } catch { return { schools: [] }; } }
export function saveCast(c) { fs.writeFileSync(CAST_FILE, JSON.stringify(c, null, 1)); }

// --- people -----------------------------------------------------------------
// A UK mobile number per person: +44 7911 1xxxxx (valid for libphonenumber).
// PHONE_BASE moves the block per run so a re-seed never collides.
let phoneSeq = Number(process.env.PHONE_BASE || Math.floor(Math.random() * 850000));
export function nextPhone() { return `+447911${String(100000 + (phoneSeq++ % 900000)).padStart(6, '0')}`; }

/** Register (with the Decision 444 tick), SMS code, sign in. */
export async function signUp({ first, last, dob = '1988-04-12', language, currency, tag }) {
  const email = `${first}.${last}.${tag || Date.now().toString(36)}@round6t.test`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  const phone = nextPhone();
  const passcode = '482913';
  await must(`register ${first}`, 'POST', '/auth/register', null, { email, phone, firstName: first, surname: last, passcode, passcodeConfirm: passcode, dateOfBirth: dob, language, currency, acceptTerms: true });
  await must(`otp ${first}`, 'POST', '/auth/otp/verify', null, { phone, code: OTP });
  const person = { email, phone, passcode, first, last };
  await signIn(person);
  person.id = JSON.parse(Buffer.from(person.tok.split('.')[1], 'base64url')).sub;
  return person;
}
export async function signIn(person) {
  const r = await call('POST', '/auth/login', null, { email: person.email, passcode: person.passcode });
  if (r.status >= 300) throw new Error(`login ${person.email}: ${r.status} ${JSON.stringify(r.body)}`);
  person.tok = r.body.accessToken;
  person.refresh = r.body.refreshToken;
  return r.body;
}

/** Runs fn over items with at most `n` at once. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** Fires all thunks at the same moment (as close as Node allows). */
export async function burst(thunks) {
  let go;
  const gate = new Promise((r) => (go = r));
  const ps = thunks.map((t) => gate.then(t));
  go();
  return Promise.all(ps);
}
