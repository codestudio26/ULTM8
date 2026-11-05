// Helpers for the Canada round 5 scripts. API defaults to the private
// proxy-free instance (see findings: the shared API cannot reach the fake Stripe).
import fs from 'fs';
import { createRequire } from 'module';
export * from '../../round4/common.mjs';
import { randomUUID } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const Stripe = require('stripe');
const stripe = new (Stripe.default || Stripe)('sk_test_fake');
export const FAKE = 'http://localhost:12111';
export const C = JSON.parse(fs.readFileSync(new URL('./cast-ca.json', import.meta.url)));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = [];
export const note = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); log.push(s); console.log(s); };

export async function webhook(type, objectId, account = C.acct, eventId = `evt_${randomUUID().replace(/-/g, '')}`) {
  const payload = JSON.stringify({ id: eventId, object: 'event', type, account, data: { object: { id: objectId, object: type.split('.')[0] } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const res = await fetch(`${process.env.API}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  return { status: res.status, body: await res.text(), eventId };
}
export async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(250); }
}
/** Make an arbitrary object in the fake Stripe store (via the dispute hook), then shape it. */
export async function fakeObject(fields) {
  const dp = await (await fetch(`${FAKE}/__disputes`, { method: 'POST', body: JSON.stringify({}) })).json();
  return (await fetch(`${FAKE}/__disputes/${dp.id}`, { method: 'POST', body: JSON.stringify(fields) })).json();
}
export async function fakeGet(id) { return (await fetch(`${FAKE}/v1/x/${id}`)).json(); }
export async function fakeSet(id, fields) { return (await fetch(`${FAKE}/__disputes/${id}`, { method: 'POST', body: JSON.stringify(fields) })).json(); }
