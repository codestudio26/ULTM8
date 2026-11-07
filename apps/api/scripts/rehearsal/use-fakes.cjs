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
//     the erasure job can delete it. GET http://localhost:REHEARSAL_R2_PORT
//     (default 12518) lists the keys held.
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
require('http').createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([...objects.keys()])); })
  .listen(Number(process.env.REHEARSAL_R2_PORT || 12518), '127.0.0.1');
