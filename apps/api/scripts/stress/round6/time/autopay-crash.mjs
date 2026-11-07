// Round 6 T: charge-auto-pay killed right after Stripe took the money, before
// the answer was saved; then restarted; then Stripe's own webhook arrives.
//   node autopay-crash.mjs
// On a clean UK card School (seed.mjs, Stripe ready), three members with a
// saved card and "Pay charges automatically" on (shortcut as in
// autopay-setup.mjs) and a one-off charge due today. clock.cjs runs the job at
// the real time with CRASH_AFTER_STRIPE=1 (exit 137 right after Stripe answers
// the first off-session charge), then again normally. Then the signed
// payment_intent.succeeded for that PaymentIntent is sent, as Stripe would.
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';
import { must, call, db, signUp, FAKE, stripeWebhook, sleep, ok, note, sectionOf, OUT } from './lib.mjs';
import { seedSchool } from './seed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
sectionOf('auto-pay killed after Stripe answered');
const tag = `ac${Date.now().toString(36)}`;
const s = await seedSchool(1, { members: 0, tag });
const today = DateTime.now().setZone(s.tz).toISODate();
const people = [];
for (let k = 0; k < 3; k++) {
  const p = await signUp({ first: `Auto${k}`, last: 'Crash', tag: `${tag}${k}` });
  await must('join', 'POST', `/schools/${s.sid}/join`, p.tok, { branchId: s.branchId });
  const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'stripe-account': s.stripeAcct, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a%40x.test' })).json();
  await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'stripe-account': s.stripeAcct, 'content-type': 'application/x-www-form-urlencoded' }, body: 'invoice_settings[default_payment_method]=pm_crash' });
  await db.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: p.id, schoolId: s.sid, stripeCustomerId: cus.id, autoPayCharges: true } });
  const ch = await must('charge', 'POST', `/schools/${s.sid}/students/${p.id}/charges`, s.owner.tok, { description: 'Seminar', amount: 3000, dueDate: today });
  people.push({ p, chargeId: ch.id ?? ch.charge?.id });
}
const planFile = path.join(OUT, `plan-crash-${tag}.json`);
fs.writeFileSync(planFile, JSON.stringify([{ at: new Date().toISOString(), jobs: ['charge-auto-pay'] }]));
const run = (extra) => spawnSync(process.execPath, ['--require', path.join(here, '../../../rehearsal/use-fakes.cjs'), path.join(here, 'clock.cjs'), planFile], { env: { ...process.env, CLOCK_QUIET: '1', CLOCK_LOG: `clock-crash-${tag}.jsonl`, REHEARSAL_R2_PORT: '12130', ...extra }, encoding: 'utf8' });
const r1 = run({ CRASH_AFTER_STRIPE: '1' });
const log = fs.readFileSync(path.join(OUT, `clock-crash-${tag}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
const crash = log.find((l) => l.crash);
note('first run', { exit: r1.status, crash });
const r2 = run({});
note('second run (restarted)', { exit: r2.status, log: fs.readFileSync(path.join(OUT, `clock-crash-${tag}.jsonl`), 'utf8').trim().split('\n').slice(-1)[0] });
const rows = [];
for (const { p, chargeId } of people) {
  const txs = await db.transaction.findMany({ where: { studentId: p.id, schoolId: s.sid, kind: 'CHARGE_PAYMENT' }, select: { id: true, status: true, stripePaymentIntentId: true, chargePaymentChannel: true } });
  rows.push({ student: p.id === crash?.studentId ? 'CRASHED' : 'other', txs });
}
note('after restart', rows);
const pi = crash?.paymentIntentId ? await (await fetch(`${FAKE}/v1/payment_intents/${crash.paymentIntentId}`)).json() : null;
note('Stripe says about the crashed PaymentIntent', { id: pi?.id, status: pi?.status, amount: pi?.amount, metadata: pi?.metadata });
if (pi) {
  const wh = await stripeWebhook({ id: `evt_crash_${tag}`, object: 'event', type: 'payment_intent.succeeded', account: s.stripeAcct, data: { object: { ...pi, object: 'payment_intent' } } });
  await sleep(2000);
}
const crashed = people.find(({ p }) => p.id === crash?.studentId);
const after = crashed ? await db.transaction.findMany({ where: { studentId: crashed.p.id, schoolId: s.sid, kind: 'CHARGE_PAYMENT' }, select: { status: true, stripePaymentIntentId: true } }) : [];
const ch = crashed ? await db.charge.findUnique({ where: { id: crashed.chargeId }, include: { allocations: true } }) : null;
const paidOnLedger = (ch?.allocations || []).reduce((n, a) => n + a.amount, 0);
ok('auto-pay: money Stripe took before the crash ends up on the member\'s ledger (after restart + webhook)', pi?.status === 'succeeded' ? paidOnLedger >= 3000 : true,
  { stripe: pi?.status, transactions: after, chargeAllocated: paidOnLedger, chargeGross: ch?.grossAmount });
await db.$disconnect();
process.exit(0);
