// Shared helpers for the booking/schedule stress run.
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../../package.json', import.meta.url));
export const { PrismaClient } = require('@prisma/client');
const { JwtService } = require('@nestjs/jwt');
export const { Queue } = require('bullmq');
import { randomUUID } from 'crypto';
export { randomUUID };

export const API = process.env.API || 'http://localhost:3200/v1';
export const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

export function token(user, grants) {
  return jwt.sign({ sub: user.id, email: user.email, grants }, { expiresIn: '6h' });
}

// Latency and status bookkeeping per label.
export const stats = {};
function rec(label, ms, status) {
  const s = (stats[label] ||= { n: 0, ms: [], codes: {} });
  s.n++; s.ms.push(ms); s.codes[status] = (s.codes[status] || 0) + 1;
}
export function report(labels) {
  const rows = [];
  for (const [label, s] of Object.entries(stats)) {
    if (labels && !labels.includes(label)) continue;
    const a = s.ms.slice().sort((x, y) => x - y);
    const p = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))] | 0;
    rows.push({ label, n: s.n, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: a[a.length - 1] | 0, codes: JSON.stringify(s.codes) });
  }
  console.table(rows);
  return rows;
}

export async function call(label, method, path, tok, body) {
  const t0 = performance.now();
  let res, text, json = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      text = await res.text();
      break;
    } catch (e) {
      if (attempt === 5) { rec(label, performance.now() - t0, 'NETERR'); return { status: 0, body: String(e) }; }
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  rec(label, performance.now() - t0, res.status);
  return { status: res.status, body: json };
}

// Run fn over items with at most `n` in flight.
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export const grant = (role, schoolId, branchId = null) => ({ role, franchiseId: null, schoolId, branchId });

// Round 6 adaptation (Decision 442 item 2): card payments wait until Stripe says
// the connected account is ready. Finish onboarding in the fake, then deliver a
// signed account.updated webhook exactly as Stripe would, and wait for the API's
// webhook job to set PaymentAccount.stripeAccountReady.
export async function makeStripeAccountReady(connectedAccountId) {
  const Stripe = require('stripe');
  const stripe = new (Stripe.default || Stripe)('sk_test_fake');
  const fake = `http://localhost:${process.env.FAKE_STRIPE_PORT ?? 12111}`;
  const r = await fetch(`${fake}/__accounts/${connectedAccountId}/ready`, { method: 'POST' });
  if (!r.ok) throw new Error(`fake stripe: account ${connectedAccountId} not found (${r.status})`);
  const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type: 'account.updated', account: connectedAccountId, data: { object: { id: connectedAccountId, object: 'account' } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const w = await fetch(`${API}/payments/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  if (w.status >= 300) throw new Error(`account.updated webhook ${w.status} ${await w.text()}`);
  for (let i = 0; i < 200; i++) {
    const a = await db.paymentAccount.findFirst({ where: { stripeConnectedAccountId: connectedAccountId }, select: { stripeAccountReady: true } });
    if (a?.stripeAccountReady) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`stripeAccountReady never set for ${connectedAccountId}`);
}
