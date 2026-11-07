// Round 6, money tester (M). Builds on the launch rehearsal helpers
// (../../../rehearsal/lib.mjs): real sign-ups through the API, jobs started
// by adding them to their queue, Stripe's signed webhooks, the fake Stripe.
// Run against a throwaway local stack only (see ../README.md / RESUME.md).
import crypto from 'crypto';
import * as R from '../../../rehearsal/lib.mjs';
export * from '../../../rehearsal/lib.mjs';
const { call, must, db, RUN, OTP, signIn } = R;

// Findings bookkeeping: every check is printed and kept, PASS / FAIL / NOTE.
export const out = [];
export function rec(area, step, status, evidence) {
  const row = { area, step, status, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence)?.slice(0, 900) };
  out.push(row);
  console.log(`${status.padEnd(5)} [${area}] ${step}${row.evidence ? '  — ' + row.evidence : ''}`);
  return status === 'PASS';
}
export const expect = (area, step, cond, evidence) => rec(area, step, cond ? 'PASS' : 'FAIL', evidence);

let seq = 0;
const uniq = () => `${RUN}${(seq++).toString(36)}`;
let phoneN = (Date.now() % 90000) + 10000;
function phone(country) {
  const n = String(phoneN++).padStart(5, '0').slice(-5);
  return country === 'BR' ? `+55119871${n}` : `+4479112${n}`;
}

/** Sign up as the apps do since Decision 444: the "I agree" tick. */
export async function signUp({ first, last, dob = '1988-04-12', country = 'GB', language, currency }) {
  const tag = uniq();
  const email = `${first}.${last}.${tag}@m6.test`.toLowerCase().replace(/[^a-z0-9.@]/g, '');
  const p = { email, phone: phone(country), passcode: '482913', first, last };
  await must(`register ${first}`, 'POST', '/auth/register', null, { email, phone: p.phone, firstName: first, surname: last, passcode: p.passcode, passcodeConfirm: p.passcode, dateOfBirth: dob, language, currency, acceptTerms: true });
  await must(`otp ${first}`, 'POST', '/auth/otp/verify', null, { phone: p.phone, code: OTP });
  await signIn(p);
  p.id = JSON.parse(Buffer.from(p.tok.split('.')[1], 'base64url')).sub;
  return p;
}

export const FAKE = `http://localhost:${process.env.FAKE_STRIPE_PORT || 12112}`;
export async function fakeCalls() { return (await fetch(`${FAKE}/__calls`)).json(); }

/** Stripe says the connected account is (or is no longer) ready, then sends
 *  account.updated, as Stripe does. Waits for the webhook job to apply it. */
export async function setStripeReady(acct, ready) {
  await fetch(`${FAKE}/__accounts/${acct}`, { method: 'POST', body: JSON.stringify({ details_submitted: ready, charges_enabled: ready }) });
  const ev = { id: `evt_${crypto.randomBytes(8).toString('hex')}`, object: 'event', type: 'account.updated', account: acct, data: { object: { id: acct, object: 'account' } } };
  const r = await R.stripeWebhook(ev);
  for (let i = 0; i < 50; i++) {
    const pa = await db.paymentAccount.findFirst({ where: { stripeConnectedAccountId: acct } });
    if (pa?.stripeAccountReady === ready) return { webhook: r.status, ready };
    await new Promise((res) => setTimeout(res, 200));
  }
  return { webhook: r.status, ready: 'TIMEOUT' };
}

/** A School with its owner, a Branch, and a payment account.
 *  kind: 'ready' (UK, Stripe ready), 'notready' (UK, Stripe onboarding
 *  started, not finished), 'br' (Brazil, Pix as bank transfer). */
export async function makeSchool(kind, name) {
  const br = kind === 'br';
  const c = br
    ? { country: 'BR', tz: 'America/Sao_Paulo', cur: 'BRL', lang: 'pt-BR', addr: { line1: 'Rua Augusta, 1500', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' } }
    : { country: 'GB', tz: 'Europe/London', cur: 'GBP', lang: 'en-GB', addr: { line1: '12 Market Street', city: 'London', postalCode: 'E1 6AN', country: 'GB' } };
  const owner = await signUp({ first: br ? 'Joao' : 'Olivia', last: `Owner${kind}`, dob: '1980-01-01', country: c.country, language: c.lang, currency: c.cur });
  const school = await must('school', 'POST', '/schools', owner.tok, { name: `${name} ${uniq()}`, timezone: c.tz, defaultCurrency: c.cur, defaultLanguage: c.lang, postalAddress: c.addr, acceptAgreement: true });
  await signIn(owner);
  const branch = await must('branch', 'POST', `/schools/${school.id}/branches`, owner.tok, { name: 'Main', postalAddress: c.addr });
  const s = { kind, c, owner, school, branch, id: school.id };
  if (br) {
    s.payAcct = await must('pa', 'POST', `/schools/${school.id}/payment-accounts`, owner.tok, { provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' });
  } else {
    s.payAcct = await must('pa', 'POST', `/schools/${school.id}/payment-accounts`, owner.tok, { provider: 'STRIPE', accountTitle: 'Main', country: 'GB' });
    await must('onboard', 'POST', `/payment-accounts/${s.payAcct.id}/connect/onboard`, owner.tok, {});
    s.acct = (await db.paymentAccount.findUnique({ where: { id: s.payAcct.id } })).stripeConnectedAccountId;
    if (kind === 'ready') s.readyResult = await setStripeReady(s.acct, true);
  }
  return s;
}

/** A member who signs up and joins the School's Branch in the app. */
export async function makeMember(s, first = 'Ana', last = 'Membro') {
  const p = await signUp({ first, last: `${last}${uniq()}`.replace(/[0-9]/g, (d) => 'abcdefghij'[d]), country: s.c.country, language: s.c.lang, currency: s.c.cur });
  await must('join', 'POST', `/schools/${s.id}/join`, p.tok, { branchId: s.branch.id });
  await signIn(p);
  return p;
}

export const plan = (s, body) => must(`plan ${body.title}`, 'POST', `/schools/${s.id}/membership-plans`, s.owner.tok, { currency: s.c.cur, ...body });

/** Start a background job as the scheduler does and wait for it. */
export const job = (name, data = {}) => R.runJob(name, data);

export const series = (membershipId) => db.recurringCharge.findUnique({ where: { membershipId } });
export const charges = (recurringChargeId) => db.charge.findMany({ where: { recurringChargeId }, orderBy: { occurrenceDate: 'asc' } });
export const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
export const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Moves a balance-billed membership and its series back in time by `n`
 *  days (the clock move every harness here uses: "n days later"). */
export async function backdate(membershipId, n) {
  const ms = n * 86400e3;
  const m = await db.membership.findUnique({ where: { id: membershipId } });
  await db.membership.update({ where: { id: membershipId }, data: { startDate: new Date(m.startDate.getTime() - ms), ...(m.expiryDate ? { expiryDate: new Date(m.expiryDate.getTime() - ms) } : {}), ...(m.cancelAt ? { cancelAt: new Date(m.cancelAt.getTime() - ms) } : {}) } });
  const r = await db.recurringCharge.findUnique({ where: { membershipId } });
  if (r) await db.recurringCharge.update({ where: { id: r.id }, data: { firstDate: new Date(r.firstDate.getTime() - ms), ...(r.nextDate ? { nextDate: new Date(r.nextDate.getTime() - ms) } : {}), ...(r.endDate ? { endDate: new Date(r.endDate.getTime() - ms) } : {}) } });
  const fz = await db.membershipFreeze.findMany({ where: { membershipId } });
  for (const f of fz) await db.membershipFreeze.update({ where: { id: f.id }, data: { startsAt: new Date(f.startsAt.getTime() - ms), endsAt: new Date(f.endsAt.getTime() - ms) } });
  return db.recurringCharge.findUnique({ where: { membershipId } });
}

/** Buys a monthly plan at a no-card School in the app and has the owner
 *  confirm the Pix order. Returns the membership. */
export async function buyMonthly(s, member, planId, confirmer = s.owner) {
  const b = await must('buy', 'POST', `/membership-plans/${planId}/purchase`, member.tok, {});
  if (b.outcome !== 'pending_confirmation') throw new Error('buy: ' + JSON.stringify(b));
  await must('confirm', 'PATCH', `/transactions/${b.transactionId}/confirm`, confirmer.tok, {});
  const m = await db.membership.findFirst({ where: { studentId: member.id, membershipPlanId: planId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
  return { m, txId: b.transactionId };
}

export function saveOut(file) {
  const fs = require_fs();
  fs.writeFileSync(new URL(file, import.meta.url), JSON.stringify(out, null, 1));
  const by = out.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log('\nTotals:', JSON.stringify(by));
}
import fsMod from 'fs';
function require_fs() { return fsMod; }
