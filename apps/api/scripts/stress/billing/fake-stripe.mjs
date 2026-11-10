// A small stand-in for the Stripe API, enough for ULTM8's own calls, so card
// payments can be stress-tested locally. Objects are kept in memory. Not for CI.
// Run: node fake-stripe.mjs (port FAKE_STRIPE_PORT, default 12111).
import http from 'http';
import { randomBytes } from 'crypto';

const port = Number(process.env.FAKE_STRIPE_PORT ?? 12111);
const store = new Map();
const calls = {};
const idempotent = new Map();
const id = (p) => `${p}_${randomBytes(9).toString('hex')}`;

function parseForm(body) {
  const out = {};
  for (const pair of body.split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')));
    const keys = k.replace(/\]/g, '').split('[');
    let o = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) o[key] = v;
      else o = o[key] ??= {};
    });
  }
  return out;
}

function save(obj) { store.set(obj.id, obj); return obj; }

// Test hook state: POST /__payment_intents/lose-next-answer makes the next
// off-session PaymentIntent succeed at "Stripe" while its answer is lost (a
// 500 to the caller), as when Stripe can't be reached after charging.
let loseNextAnswer = false;

function paymentIntent(params, account) {
  const pi = id('pi');
  const offSession = params.off_session === 'true' && params.confirm === 'true';
  // An amount ending in 13 (minor units) is declined when charged off-session.
  const declined = offSession && String(params.amount).endsWith('13');
  const obj = save({ id: pi, object: 'payment_intent', amount: Number(params.amount ?? 0), currency: params.currency, client_secret: `${pi}_secret_x`, status: offSession ? (declined ? 'requires_payment_method' : 'succeeded') : 'requires_payment_method', metadata: params.metadata ?? {}, account, latest_charge: { id: id('ch'), receipt_url: `https://pay.stripe.test/receipts/${pi}` } });
  if (declined) return { error: { status: 402, body: { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.', payment_intent: obj } } } };
  if (offSession && loseNextAnswer) {
    loseNextAnswer = false;
    save({ id: obj.latest_charge.id, object: 'charge', amount: obj.amount, amount_refunded: 0, refunded: false, currency: obj.currency, payment_intent: pi, receipt_url: obj.latest_charge.receipt_url });
    return { error: { status: 500, body: { error: { type: 'api_error', message: 'fake-stripe: the answer was lost' } } } };
  }
  return obj;
}

const handlers = {
  'POST /v1/payment_intents': (p, a) => paymentIntent(p, a),
  'POST /v1/customers': (p) => save({ id: id('cus'), object: 'customer', email: p.email, invoice_settings: { default_payment_method: null }, metadata: p.metadata ?? {} }),
  'POST /v1/checkout/sessions': (p, a) => {
    const cs = id('cs');
    let pi = null;
    if (p.mode === 'payment') pi = paymentIntent({ amount: p.line_items?.['0']?.price_data?.unit_amount ?? 0, currency: p.line_items?.['0']?.price_data?.currency }, a).id;
    return save({ id: cs, object: 'checkout.session', mode: p.mode, url: `https://checkout.stripe.test/${cs}`, payment_intent: pi, customer: p.customer ?? null, setup_intent: p.mode === 'setup' ? id('seti') : null, metadata: p.metadata ?? {}, line_items: p.line_items ?? {}, payment_intent_data: p.payment_intent_data ?? {}, account: a });
  },
  'POST /v1/refunds': (p) => {
    const pi = store.get(p.payment_intent);
    const amount = Number(p.amount ?? pi?.amount ?? 0);
    return save({ id: id('re'), object: 'refund', status: 'succeeded', amount, payment_intent: p.payment_intent });
  },
  'POST /v1/subscriptions': (p, a) => {
    const pi = paymentIntent({ amount: 1000, currency: 'gbp' }, a);
    // Both shapes: the older payment_intent field and the current API's
    // payments list and confirmation_secret (src/payments/stripe-first-invoice.ts).
    const inv = save({ id: id('in'), object: 'invoice', payment_intent: pi, payments: { object: 'list', data: [{ is_default: true, payment: { type: 'payment_intent', payment_intent: pi.id } }] }, confirmation_secret: { type: 'payment_intent', client_secret: pi.client_secret } });
    return save({ id: id('sub'), object: 'subscription', status: 'incomplete', latest_invoice: inv, items: { object: 'list', data: [{ id: id('si'), price: { id: p.items?.['0']?.price ?? id('price') } }] }, metadata: p.metadata ?? {} });
  },
  // A new connected account, as Stripe makes it: onboarding not finished yet,
  // so not ready to take charges (Decision 442 item 2). The test hook
  // POST /__accounts/:id/complete finishes onboarding.
  'POST /v1/accounts': () => save({ id: id('acct'), object: 'account', details_submitted: false, charges_enabled: false }),
  'POST /v1/account_links': () => ({ object: 'account_link', url: `https://connect.stripe.test/${id('al')}` }),
  'POST /v1/prices': (p) => save({ id: id('price'), object: 'price', unit_amount: Number(p.unit_amount ?? 0), currency: p.currency }),
  'POST /v1/products': (p) => save({ id: id('prod'), object: 'product', name: p.name }),
};

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const account = req.headers['stripe-account'];
    const key = `${req.method} ${path}`;
    calls[key] = (calls[key] ?? 0) + 1;
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'request-id': id('req') }); res.end(JSON.stringify(obj)); };
    if (path === '/__calls') return send(200, calls);
    if (path === '/__store') return send(200, { size: store.size });
    // Test hooks: make or change a Dispute, as Stripe would after a chargeback.
    if (req.method === 'POST' && path === '/__disputes') {
      const p = JSON.parse(body || '{}');
      return send(200, save({ id: id('dp'), object: 'dispute', payment_intent: p.payment_intent, amount: p.amount ?? 0, currency: p.currency ?? 'gbp', status: p.status ?? 'needs_response' }));
    }
    // Test hook: the member pays on the hosted Checkout page. As Stripe does,
    // the PaymentIntent is made then, for the sum of the line items and with
    // payment_intent_data.metadata, and it has succeeded.
    const pay = path.match(/^\/__checkout\/(cs_[0-9a-f]+)\/pay$/);
    if (req.method === 'POST' && pay && store.has(pay[1])) {
      const cs = store.get(pay[1]);
      const items = Object.values(cs.line_items ?? {});
      const amount = items.reduce((n, li) => n + Number(li.price_data?.unit_amount ?? 0) * Number(li.quantity ?? 1), 0);
      const pi = save({ id: id('pi'), object: 'payment_intent', amount, currency: items[0]?.price_data?.currency, status: 'succeeded', metadata: cs.payment_intent_data?.metadata ?? {}, account: cs.account, latest_charge: { id: id('ch'), receipt_url: `https://pay.stripe.test/receipts/${cs.id}` } });
      save({ id: pi.latest_charge.id, object: 'charge', amount, amount_refunded: 0, refunded: false, currency: pi.currency, payment_intent: pi.id, receipt_url: pi.latest_charge.receipt_url });
      cs.payment_intent = pi.id; cs.status = 'complete'; cs.payment_status = 'paid';
      return send(200, { session: cs, payment_intent: pi, lines: items.map((li) => ({ name: li.price_data?.product_data?.name, amount: Number(li.price_data?.unit_amount ?? 0) })) });
    }
    if (req.method === 'POST' && path === '/__payment_intents/lose-next-answer') { loseNextAnswer = true; return send(200, { ok: true }); }
    if (req.method === 'GET' && path === '/__payment_intents') return send(200, [...store.values()].filter((o) => o.object === 'payment_intent'));
    // Test hook: the member saves a card on a hosted Checkout in setup mode:
    // the SetupIntent and its card PaymentMethod are made then.
    const setup = path.match(/^\/__checkout\/(cs_[0-9a-f]+)\/save-card$/);
    if (req.method === 'POST' && setup && store.has(setup[1])) {
      const cs = store.get(setup[1]);
      // With no Customer given, Checkout makes one for the saved card.
      if (!cs.customer) cs.customer = save({ id: id('cus'), object: 'customer', invoice_settings: { default_payment_method: null }, metadata: {} }).id;
      const pm = save({ id: id('pm'), object: 'payment_method', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, country: 'GB' }, customer: cs.customer });
      const seti = save({ id: cs.setup_intent, object: 'setup_intent', status: 'succeeded', payment_method: pm.id, customer: cs.customer });
      cs.status = 'complete';
      return send(200, { session: cs, setup_intent: seti, payment_method: pm });
    }
    // Test hook: the School finishes Stripe's onboarding (details given,
    // charges enabled). Stripe then sends account.updated.
    const done = path.match(/^\/__accounts\/(acct_[0-9a-f]+)\/complete$/);
    if (req.method === 'POST' && done && store.has(done[1])) return send(200, Object.assign(store.get(done[1]), { details_submitted: true, charges_enabled: true }));
    // Test hook: the School refunds a card payment in its Stripe Dashboard.
    const rf = path.match(/^\/__charges\/(ch_[0-9a-f]+)\/refund$/);
    if (req.method === 'POST' && rf && store.has(rf[1])) {
      const ch = store.get(rf[1]);
      const amount = Number(JSON.parse(body || '{}').amount ?? ch.amount - ch.amount_refunded);
      ch.amount_refunded = Math.min(ch.amount, ch.amount_refunded + amount);
      ch.refunded = ch.amount_refunded === ch.amount;
      save({ id: id('re'), object: 'refund', status: 'succeeded', amount, charge: ch.id, payment_intent: ch.payment_intent });
      return send(200, ch);
    }
    if (req.method === 'GET' && path === '/__checkout') return send(200, [...store.values()].filter((o) => o.object === 'checkout.session'));
    const dm = path.match(/^\/__disputes\/(dp_[0-9a-f]+)$/);
    if (req.method === 'POST' && dm && store.has(dm[1])) return send(200, Object.assign(store.get(dm[1]), JSON.parse(body || '{}')));
    const params = parseForm(body);
    const h = handlers[key];
    if (h) {
      // Idempotency keys, as Stripe keeps them: the same key on the same
      // account and endpoint returns the first response again.
      const idem = req.headers['idempotency-key'];
      const idemKey = idem ? `${account ?? ''}|${key}|${idem}` : null;
      if (idemKey && idempotent.has(idemKey)) {
        const [status, out] = idempotent.get(idemKey);
        calls[`${key} (replayed)`] = (calls[`${key} (replayed)`] ?? 0) + 1;
        return send(status, out);
      }
      const out = h(params, account);
      const reply = out?.error ? [out.error.status, out.error.body] : [200, out];
      if (idemKey) idempotent.set(idemKey, reply);
      return send(...reply);
    }
    // Generic retrieve / update / cancel / delete on a stored object.
    const m = path.match(/^\/v1\/(?:[a-z_]+\/)+?([a-z]+_[0-9a-f]+)(?:\/(cancel))?$/);
    if (m && store.has(m[1])) {
      const obj = store.get(m[1]);
      if (m[2] === 'cancel' || req.method === 'DELETE') obj.status = 'canceled';
      if (req.method === 'POST' && !m[2]) Object.assign(obj, params);
      // expand[]: a field holding another object's id is returned as that object.
      const expand = [...url.searchParams.entries()].filter(([k]) => k.startsWith('expand')).map(([, v]) => v);
      if (expand.length) {
        const out = JSON.parse(JSON.stringify(obj));
        for (const field of expand) {
          const keys = field.split('.');
          let o = out;
          for (const k of keys.slice(0, -1)) o = o?.[k];
          const last = keys[keys.length - 1];
          if (o && typeof o[last] === 'string' && store.has(o[last])) o[last] = store.get(o[last]);
        }
        return send(200, out);
      }
      return send(200, obj);
    }
    if (m && req.method === 'GET') return send(404, { error: { type: 'invalid_request_error', message: `No such object: ${m[1]}` } });
    send(400, { error: { type: 'invalid_request_error', message: `fake-stripe: unhandled ${key}` } });
  });
}).listen(port, () => console.log(`fake stripe on :${port}`));
