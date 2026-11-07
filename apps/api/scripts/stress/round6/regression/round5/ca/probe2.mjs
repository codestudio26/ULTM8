import fs from 'fs';
import { C, db, webhook, fakeObject, FAKE, sleep } from './lib-ca.mjs';
const state = JSON.parse(fs.readFileSync('./state.json'));
const s = state.subs[27];
const p = (await (await fetch(`${FAKE}/v1/payment_intents`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'stripe-account': C.acct }, body: `amount=18900&currency=cad` })).json()).id;
const now = Math.floor(Date.now()/1000);
const inv = await fakeObject({ object: 'invoice', parent: { subscription_details: { subscription: s.sub, metadata: {} } }, billing_reason: 'subscription_cycle', currency: 'cad', amount_paid: 18900, amount_due: 18900, created: now, status_transitions: { paid_at: now }, period_start: now, period_end: now + 2592000, lines: { data: [] }, payments: { data: [{ payment: { type: 'payment_intent', payment_intent: p } }] } });
console.log(inv.id, p);
const w = await webhook('invoice.paid', inv.id);
console.log(w.status, w.body);
for (let i = 0; i < 12; i++) { await sleep(1000); const r = await db.transaction.findMany({ where: { membershipId: s.membershipId, kind: 'RENEWAL' } }); if (r.length) { console.log('row', r[0].status, r[0].amount, 'after', i+1, 's'); break; } if (i === 11) console.log('no row'); }
const ev = await db.$queryRawUnsafe(`select * from "ProcessedStripeEvent" order by 1 desc limit 0`).catch(e => e.message.slice(0,100));
await db.$disconnect();
