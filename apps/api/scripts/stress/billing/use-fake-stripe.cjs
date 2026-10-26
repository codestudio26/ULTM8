// node --require ./use-fake-stripe.cjs dist/main.js — points every `new Stripe(key, opts)` at fake-stripe.mjs.
const Module = require('module');
const port = Number(process.env.FAKE_STRIPE_PORT || 12111);
const load = Module._load;
Module._load = function (request, parent, isMain) {
  const mod = load.apply(this, arguments);
  if (request !== 'stripe' || mod.__fake) return mod;
  const Real = mod.default || mod;
  function Fake(key, opts) { return new Real(key, { ...(opts || {}), host: 'localhost', port, protocol: 'http', maxNetworkRetries: 0 }); }
  Object.assign(Fake, Real);
  Fake.prototype = Real.prototype;
  Fake.default = Fake;
  Fake.Stripe = Fake;
  Fake.__fake = true;
  return Fake;
};
