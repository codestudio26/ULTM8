// Shared helpers for the launch rehearsal (docs/handover/LAUNCH-REHEARSAL-1.md).
//
// Everything a person would do goes through the real HTTP API as that person,
// with a real sign-in (register → SMS code → sign in). The only shortcuts are
// the ones a person can't take from a laptop, and each is named where used:
// background jobs are started by adding them to their queue (as the scheduler
// would), "30 days later" is reached by moving the deletion due date back,
// and Stripe's own signed webhook is sent as Stripe would send it.
//
//   API                  default http://localhost:3317/v1
//   DATABASE_URL         superuser, read-only checks and the clock move
//   REDIS_URL            to start background jobs
//   STRIPE_WEBHOOK_SECRET  to sign the fake Stripe webhooks
//   REHEARSAL_OTP        the code the fake Twilio approves (default 123456)
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(new URL('../../package.json', import.meta.url));
export const { PrismaClient } = require('@prisma/client');
const { Queue, QueueEvents } = require('bullmq');

export const API = process.env.API || 'http://localhost:3317/v1';
export const OTP = process.env.REHEARSAL_OTP || '123456';
export const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
export const RUN = process.env.RUN_ID || Date.now().toString(36);

/** One HTTP call. The sign-in routes allow 20 calls a minute from one address,
 *  and the whole rehearsal runs from one, so a 429 waits as long as the API
 *  says (Retry-After) and tries again; `throttled` counts how often. */
export const throttled = { n: 0 };
export async function call(method, path, tok, body, headers = {}) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== 429 || attempt >= 8) break;
    throttled.n++;
    await res.text();
    const wait = Number(res.headers.get('retry-after') || res.headers.get('retry-after-default') || 10);
    await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1), 61) * 1000));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  // Every error message a School's people get, for the language check (J6).
  if (res.status >= 400 && json?.error?.message && current?.school) {
    const seen = (errorsSeen[current.school] ||= new Map());
    seen.set(json.error.message, { status: res.status, code: json.error.code, message: json.error.message, path });
  }
  return { status: res.status, body: json };
}

/** Throws with the response when the status isn't 2xx, so a setup step that
 *  fails is reported as the step that failed, not as a later confusing one. */
export async function must(label, method, path, tok, body, headers) {
  const r = await call(method, path, tok, body, headers);
  if (r.status >= 300) throw new Error(`${label}: ${method} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
}

// --- Journey results -------------------------------------------------------
export const results = [];
export const errorsSeen = {};
let current = null;
/** Start a journey section, e.g. journey('A', '1', 'Owner sign-up and School setup'). */
export function journey(school, id, title) { current = { school, id, title }; }
/** Record one check: status PASS, FAIL, BLOCKED or NOTE. */
export function check(step, status, evidence) {
  const row = { school: current?.school, journey: current?.id, step, status, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence)?.slice(0, 600) };
  results.push(row);
  console.log(`${status.padEnd(7)} ${row.school}·J${row.journey}  ${step}${row.evidence ? '  — ' + row.evidence : ''}`);
  return status === 'PASS';
}
export const ok = (step, cond, evidence) => check(step, cond ? 'PASS' : 'FAIL', evidence);
/** Run a step; an exception becomes a FAIL with its message, so one broken
 *  step doesn't hide the rest of the rehearsal. */
export async function step(name, fn) {
  try { return await fn(); } catch (e) { check(name, 'FAIL', String(e.message || e).slice(0, 600)); return undefined; }
}
export function save(file) {
  fs.writeFileSync(new URL(file, import.meta.url), JSON.stringify(results, null, 1));
  const by = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log('\nTotals:', JSON.stringify(by));
}

// --- People ----------------------------------------------------------------
let phoneSeq = 0;
/** A valid mobile number per country, unique per run. */
export function phoneFor(country) {
  const n = String((parseInt(RUN.slice(-4), 36) % 900) * 100 + phoneSeq++).padStart(5, '0').slice(-5);
  return country === 'BR' ? `+55119870${n}` : `+4479111${n}`;
}

/** Sign up through the API exactly as the apps do: register, the SMS code, sign in. */
export async function signUp({ first, last, dob = '1988-04-12', country = 'GB', language, currency }) {
  const email = `${first}.${last}.${RUN}@rehearsal.test`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  const phone = phoneFor(country);
  const passcode = '482913';
  await must(`register ${first}`, 'POST', '/auth/register', null, { email, phone, firstName: first, surname: last, passcode, passcodeConfirm: passcode, dateOfBirth: dob, language, currency, acceptTerms: true });
  await must(`otp ${first}`, 'POST', '/auth/otp/verify', null, { phone, code: OTP });
  const person = { email, phone, passcode, first, last };
  await signIn(person);
  person.id = JSON.parse(Buffer.from(person.tok.split('.')[1], 'base64url')).sub;
  return person;
}
/** Sign in again (also picks up new roles in the token). */
export async function signIn(person) {
  const r = await call('POST', '/auth/login', null, { email: person.email, passcode: person.passcode });
  person.lastLogin = r.body;
  if (r.status >= 300) throw new Error(`login ${person.email}: ${r.status} ${JSON.stringify(r.body)}`);
  person.tok = r.body.accessToken;
  person.refresh = r.body.refreshToken;
  return r.body;
}
/** A fresh step-up token (re-entering the passcode), for the sensitive actions. */
export async function stepUp(person) {
  const r = await must('step-up', 'POST', '/auth/step-up/verify', person.tok, { passcode: person.passcode });
  return r.stepUpToken ?? r.token ?? r;
}

// --- Background jobs, started the way the scheduler starts them -------------
export async function runJob(name, data = {}) {
  const connection = { url: process.env.REDIS_URL };
  const q = new Queue(name, { connection });
  const ev = new QueueEvents(name, { connection });
  await ev.waitUntilReady();
  try {
    const job = await q.add('run', data);
    return await job.waitUntilFinished(ev, 120e3);
  } finally { await ev.close(); await q.close(); }
}

// --- Stripe's signed webhook, as Stripe sends it ----------------------------
export async function stripeWebhook(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  const res = await fetch(API + '/payments/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: payload });
  return { status: res.status, body: await res.text() };
}
export const FAKE_STRIPE = `http://localhost:${process.env.FAKE_STRIPE_PORT || 12111}`;
export const fakeStripeGet = async (id) => (await fetch(`${FAKE_STRIPE}/v1/payment_intents/${id}`)).json();

export const days = (n) => n * 86400e3;
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
