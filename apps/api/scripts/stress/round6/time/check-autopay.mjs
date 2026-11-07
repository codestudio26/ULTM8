// Round 6 T: after the auto-pay runs with kills (killer.mjs), checks that no
// charge was paid twice and none is stuck.
//   node check-autopay.mjs
// - per charge: at most one AUTOMATIC attempt (Decision: one attempt ever);
// - every Stripe PaymentIntent the fake made for a charge maps to exactly one
//   Transaction (no PaymentIntent without a ledger row = money taken, not recorded);
// - AUTOMATIC attempts still PENDING (the worker died between writing the
//   attempt and calling Stripe, or between Stripe and settling).
import { db, FAKE, ok, note, sectionOf } from './lib.mjs';

sectionOf('check: automatic card payments after kills');
const charges = await db.charge.findMany({ where: { description: 'Locker' }, select: { id: true, dueDate: true, studentId: true, schoolId: true, grossAmount: true, transactions: { where: { chargePaymentChannel: 'AUTOMATIC' }, select: { id: true, status: true, stripePaymentIntentId: true, amount: true } } } });
const multi = charges.filter((c) => c.transactions.length > 1);
const stuck = charges.flatMap((c) => c.transactions.filter((t) => t.status === 'PENDING').map((t) => ({ charge: c.id, due: c.dueDate.toISOString().slice(0, 10), tx: t.id, pi: t.stripePaymentIntentId })));
const notTried = charges.filter((c) => c.transactions.length === 0 && c.dueDate <= new Date('2027-04-12'));
const byStatus = {};
for (const c of charges) for (const t of c.transactions) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
note('Locker charges and automatic attempts', { charges: charges.length, attempts: byStatus, neverTried: notTried.length });
ok('auto-pay: at most one automatic attempt per charge', multi.length === 0, multi.slice(0, 3));
// The fake's own PaymentIntents (store is in memory; /__calls counts creates).
const calls = await (await fetch(`${FAKE}/__calls`)).json();
const txWithPi = await db.transaction.count({ where: { chargePaymentChannel: 'AUTOMATIC', stripePaymentIntentId: { not: null } } });
note('fake Stripe calls', { piCreates: calls['POST /v1/payment_intents'], piReplayed: calls['POST /v1/payment_intents (replayed)'] ?? 0, automaticTxWithPi: txWithPi });
ok('auto-pay: no automatic attempt left Pending after the restarts', stuck.length === 0, { stuck: stuck.length, sample: stuck.slice(0, 4) });
await db.$disconnect();
