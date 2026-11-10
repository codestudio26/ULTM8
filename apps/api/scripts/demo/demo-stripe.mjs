// Pretend Stripe for the demo: a thin layer in front of the rehearsal's fake
// (../stress/billing/fake-stripe.mjs), which keeps its objects in memory only.
// The demo's seeded rows carry Stripe ids that fake never made (the members'
// card subscriptions, the Schools' connected accounts, past invoices and
// payments), so clicking "cancel", "freeze" or "refund" on one would get
// "No such object". This layer answers for those ids instead, as Stripe would
// for a live, healthy object, and passes everything else to the fake.
//
// Env: DEMO_STRIPE_PORT (the port the API is pointed at, FAKE_STRIPE_PORT in
// use-fakes.cjs), UPSTREAM_STRIPE_PORT (the rehearsal fake). Test-only; never
// in front of real Stripe.
import http from 'http';

const PORT = Number(process.env.DEMO_STRIPE_PORT || 12540);
const UPSTREAM = Number(process.env.UPSTREAM_STRIPE_PORT || 12539);
const known = new Map(); // id -> object we've answered for (keeps updates)

function parseForm(body) {
  const out = {};
  for (const pair of body.split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')));
    const keys = k.replace(/\]/g, '').split('[');
    let o = out;
    keys.forEach((key, i) => { if (i === keys.length - 1) o[key] = v; else o = o[key] ??= {}; });
  }
  return out;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** A plausible live object for an id Stripe would know and the fake doesn't. */
function synth(id, type) {
  const base = { id, livemode: false, metadata: {} };
  const p = id.split('_')[0];
  if (p === 'sub') {
    return { ...base, object: 'subscription', status: 'active', cancel_at_period_end: false, cancel_at: null, canceled_at: null, pause_collection: null, trial_end: null,
      current_period_start: nowSec() - 10 * 86400, current_period_end: nowSec() + 20 * 86400, billing_cycle_anchor: nowSec() - 10 * 86400,
      items: { object: 'list', data: [{ id: `si_${id.slice(4)}`, object: 'subscription_item', quantity: 1, current_period_start: nowSec() - 10 * 86400, current_period_end: nowSec() + 20 * 86400, price: { id: 'price_demo', object: 'price', unit_amount: 0, currency: 'gbp', recurring: { interval: 'month', interval_count: 1 } } }] },
      latest_invoice: null, customer: null, default_payment_method: null };
  }
  if (p === 'acct') return { ...base, object: 'account', details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [], past_due: [], disabled_reason: null }, capabilities: { card_payments: 'active', transfers: 'active' } };
  if (p === 'cus') return { ...base, object: 'customer', invoice_settings: { default_payment_method: null } };
  if (p === 'pi') return { ...base, object: 'payment_intent', status: 'succeeded', amount: 0, amount_received: 0, currency: 'gbp', latest_charge: `ch_${id.slice(3)}` };
  if (p === 'ch') return { ...base, object: 'charge', status: 'succeeded', paid: true, refunded: false, amount_refunded: 0, receipt_url: `https://pay.stripe.test/receipts/${id}` };
  if (p === 'in') return { ...base, object: 'invoice', status: 'paid', amount_paid: 0, amount_due: 0, currency: 'gbp', created: nowSec(), hosted_invoice_url: `https://pay.stripe.test/invoices/${id}` };
  return { ...base, object: type || 'object' };
}

function forward(req, body, res, onAnswer) {
  const up = http.request({ hostname: '127.0.0.1', port: UPSTREAM, method: req.method, path: req.url, headers: req.headers }, (r) => {
    let out = '';
    r.on('data', (c) => (out += c));
    r.on('end', () => onAnswer(r.statusCode, r.headers, out));
  });
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'api_error', message: `demo-stripe: upstream ${e.message}` } })); });
  up.end(body);
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    // /v1/<type>/<id>[/cancel|/resume|...] on an object the fake never made.
    const m = url.pathname.match(/^\/v1\/([a-z_]+)\/([a-z]+_[0-9A-Za-z]+)(?:\/([a-z_]+))?$/);
    forward(req, body, res, (status, headers, out) => {
      const unknown = status === 404 || (status === 400 && /fake-stripe: unhandled/.test(out));
      if (m && unknown && !/^__/.test(m[1])) {
        const [, type, id, action] = m;
        const obj = known.get(id) ?? synth(id, type.replace(/s$/, ''));
        if (req.method === 'POST') {
          const params = parseForm(body);
          if (action === 'cancel' || action === 'void') obj.status = obj.object === 'invoice' ? 'void' : 'canceled';
          else if (action === 'resume') { obj.status = 'active'; obj.pause_collection = null; }
          else if (!action) for (const [k, v] of Object.entries(params)) obj[k] = v === '' ? null : v === 'true' ? true : v === 'false' ? false : v;
          if (obj.cancel_at_period_end === true && obj.object === 'subscription') obj.cancel_at = obj.current_period_end;
        }
        if (req.method === 'DELETE') obj.status = obj.object === 'subscription' ? 'canceled' : obj.status;
        known.set(id, obj);
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_demo${Date.now()}` });
        return res.end(JSON.stringify(obj));
      }
      res.writeHead(status, headers);
      res.end(out);
    });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`demo stripe on :${PORT} (fake upstream :${UPSTREAM})`));
