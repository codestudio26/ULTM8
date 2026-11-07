// Round 6 T: automatic card payment of charges at the card Schools, for the
// kill-and-restart test of charge-auto-pay.
//   node autopay-setup.mjs FIRST_DATE [FIRST_DATE_2]
// Shortcut named: the saved card. A member saves a card through Stripe's
// hosted setup page and a webhook (checkout.session.completed); here the
// Stripe Customer is made on the fake with a default payment method, and the
// StudentPaymentMethod row (with "Pay charges automatically" on) is written
// directly. The monthly charges are made through the API by the owner
// (Decision 412 recurring charges). Amounts ending in 13 are declined by the fake.
import { randomUUID } from 'crypto';
import { must, db, loadCast, FAKE, note, sectionOf, pool, signIn } from './lib.mjs';

const [first = '2027-03-05', first2 = '2027-03-31'] = process.argv.slice(2);
const cast = loadCast();
sectionOf('setup: automatic card payments');
for (const s of cast.schools.filter((x) => x.provider === 'STRIPE')) {
  let n = 0;
  await signIn(s.owner);
  await pool(s.memberIds.map((id, k) => [id, k]), 6, async ([studentId, k]) => {
    const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'stripe-account': s.stripeAcct, 'content-type': 'application/x-www-form-urlencoded' }, body: `email=m${k}%40x.test` })).json();
    await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'stripe-account': s.stripeAcct, 'content-type': 'application/x-www-form-urlencoded' }, body: `invoice_settings[default_payment_method]=pm_${randomUUID().replace(/-/g, '').slice(0, 18)}` });
    await db.studentPaymentMethod.upsert({ where: { studentId_schoolId: { studentId, schoolId: s.sid } }, create: { id: randomUUID(), studentId, schoolId: s.sid, stripeCustomerId: cus.id, autoPayCharges: true }, update: { stripeCustomerId: cus.id, autoPayCharges: true } });
    await must('recurring charge', 'POST', `/schools/${s.sid}/students/${studentId}/recurring-charges`, s.owner.tok, {
      description: 'Locker', amount: k % 10 === 3 ? 2013 : 2000, frequency: 'MONTHLY', firstDate: k % 2 ? first2 : first,
    });
    n++;
  });
  note(`School ${s.i} ${s.ck}`, `${n} members with a saved card, auto-pay on and a monthly Locker charge from ${first} / ${first2}`);
}
await db.$disconnect();
