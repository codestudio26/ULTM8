// node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js
//
// Test-only stand-ins for the two outside services a real sign-up and a real
// card payment need, so the launch rehearsal can run the real journeys on a
// laptop without any live key:
//   - Stripe: every `new Stripe(...)` talks to ../stress/billing/fake-stripe.mjs.
//   - Twilio Verify: no SMS is sent; the code REHEARSAL_OTP (default 123456)
//     is the only one approved. Set TWILIO_* to any non-empty value so the API
//     treats SMS as configured.
//   - R2 (S3) object storage: PutObject, DeleteObject, HeadObject and
//     GetObject are kept in memory, so staff can upload a member's file and
//     the erasure job can delete it. GET http://localhost:<its port> lists
//     the keys held; PUT /<bucket>/<key> stores one, as a browser's upload to
//     a presigned URL would. Its port is REHEARSAL_R2_PORT when set; otherwise
//     a free port the system picks for this run (Decision 451 item 11: a
//     fixed port clashed with another run). Either way the port is printed
//     and written to fake-r2-port.cjs's file for this API's PORT, where the
//     journeys (j5-delete.mjs) read it.
// Never load this in a deployed API.
require('../stress/billing/use-fake-stripe.cjs');
const Module = require('module');
const OTP = process.env.REHEARSAL_OTP || '123456';
const load = Module._load;
Module._load = function (request) {
  const mod = load.apply(this, arguments);
  if (request !== 'twilio' || mod.__fake) return mod;
  const sent = [];
  class FakeTwilio {
    constructor() {
      this.verify = { v2: { services: () => ({
        verifications: { create: async ({ to }) => { sent.push(to); return { status: 'pending', to }; } },
        verificationChecks: { create: async ({ to, code }) => ({ status: code === OTP ? 'approved' : 'pending', to }) },
      }) } };
    }
  }
  const fake = { Twilio: FakeTwilio, default: FakeTwilio, __fake: true, __sent: sent };
  return fake;
};

// --- R2 / S3 ---------------------------------------------------------------
const objects = new Map();
let s3Patched = false;
const loadS3 = Module._load;
Module._load = function (request) {
  const mod = loadS3.apply(this, arguments);
  if (request !== '@aws-sdk/client-s3' || s3Patched) return mod;
  s3Patched = true;
  mod.S3Client.prototype.send = async function (command) {
    const name = command.constructor.name;
    const { Bucket, Key } = command.input ?? {};
    const k = `${Bucket}/${Key}`;
    if (name === 'PutObjectCommand') { objects.set(k, { size: command.input.Body?.length ?? 0, type: command.input.ContentType }); return { ETag: '"fake"' }; }
    if (name === 'DeleteObjectCommand') { objects.delete(k); return {}; }
    if (name === 'HeadObjectCommand' || name === 'GetObjectCommand') {
      if (!objects.has(k)) { const e = new Error('NotFound'); e.name = 'NotFound'; e.$metadata = { httpStatusCode: 404 }; throw e; }
      return { ContentLength: objects.get(k).size, ContentType: objects.get(k).type };
    }
    throw new Error(`rehearsal fake R2: ${name} is not faked`);
  };
  return mod;
};
// PUT /<bucket>/<key> stands in for the browser's own upload to a presigned
// URL (a coach's certification file): the object is then held like the rest.
const fakeR2 = require('http').createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'PUT') {
    let size = 0;
    req.on('data', (c) => (size += c.length));
    req.on('end', () => { objects.set(decodeURIComponent(req.url.slice(1)), { size, type: req.headers['content-type'] }); res.end('{}'); });
    return;
  }
  res.end(JSON.stringify([...objects.keys()]));
});
fakeR2.listen(Number(process.env.REHEARSAL_R2_PORT || 0), '127.0.0.1', () => {
  const { port } = fakeR2.address();
  const file = require('./fake-r2-port.cjs').fakeR2PortFile(process.env.PORT || 3000);
  try {
    require('fs').writeFileSync(file, String(port));
  } catch (err) {
    console.warn(`[use-fakes] could not write ${file}: ${err.message}`);
  }
  console.log(`[use-fakes] fake R2 storage on http://127.0.0.1:${port} (written to ${file})`);
});
// Never keep the process alive for the fake alone.
fakeR2.unref();
