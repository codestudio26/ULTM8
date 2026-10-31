/**
 * The first run of the app's real Stripe integration against a Stripe TEST-MODE
 * sandbox (every other Stripe test in this repo uses fakes). Not part of CI:
 * the file name doesn't match either Jest config CI uses, it has its own
 * (test/jest-stripe-sandbox.json, `npm run test:stripe-sandbox`), and it skips
 * itself unless STRIPE_SANDBOX=1 and Stripe test mode is reachable.
 *
 * How it runs:
 * - The real AppModule over real HTTP, with the real StripeClientService. Its
 *   clients are wrapped (wrapStripe) only to record every Stripe call and the
 *   exact error Stripe returned, to tag what gets created with
 *   `metadata.ultm8_sandbox_run`, and, for the renewal flow only, to put the
 *   new Customer on a Stripe test clock. Nothing the app decides is changed.
 * - Webhooks: Stripe can't reach this machine, so each flow fetches the real
 *   events Stripe produced (events.list), signs them locally with
 *   STRIPE_WEBHOOK_SECRET and POSTs them to the app's real webhook endpoint;
 *   the real stripe-webhook-processing worker then handles them (BullMQ,
 *   REDIS_URL).
 * - Test mode only: the run stops before anything else unless Stripe says
 *   `livemode: false` and the key isn't an sk_live_ one.
 *
 * Every step records PASS / FAIL / BLOCKED with the exact Stripe response, and
 * the whole table is printed and written as JSON (STRIPE_SANDBOX_REPORT, or a
 * file in the OS temp directory) at the end.
 *
 * The sandbox platform can't create connected accounts that can take charges
 * without a browser (see step 2), so the money flows use the platform account's
 * own id as the School's connected account: every request still goes out with
 * a Stripe-Account header, as it would for a real School, and the events are
 * delivered with that id as their `account`, as Connect would.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService, stripeProxyAgent } from '../src/payments/stripe-client.service';
import { PaymentsService } from '../src/payments/payments.service';
import { ChargeAutoPayProcessor } from '../src/jobs/charge-auto-pay.processor';
import { LateFeeProcessor } from '../src/jobs/late-fee.processor';
import { STRIPE_WEBHOOK_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

/**
 * Opt-in, and only against a reachable Stripe test-mode account. Checked once,
 * before Jest collects the tests, in a child process (Jest can't skip a
 * describe from an async hook): GET /v1/balance through HTTPS_PROXY when one is
 * set, as the app's own client does (stripeProxyAgent).
 * - Not opted in (STRIPE_SANDBOX unset): skipped.
 * - Stripe unreachable (no route, timeout, or any non-200, e.g. 401 with no
 *   key): skipped, with the reason printed, so a run without Stripe access
 *   never fails.
 * - An sk_live_ key, or Stripe reporting livemode: true: the run fails at once.
 */
function sandboxSkipReason(): string | null {
  if (process.env.STRIPE_SANDBOX !== '1') return 'STRIPE_SANDBOX is not 1';
  if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
    throw new Error('[stripe-sandbox] STRIPE_SECRET_KEY is a live key — refusing to run');
  }
  const probe = `
    const https = require('https');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const req = https.request({
      host: 'api.stripe.com', path: '/v1/balance', timeout: 15000,
      headers: { Authorization: 'Bearer ' + (process.env.STRIPE_SECRET_KEY || '') },
      agent: proxy ? new HttpsProxyAgent(proxy) : undefined,
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode !== 200) { console.log('HTTP ' + res.statusCode); process.exit(2); }
        let live;
        try { live = JSON.parse(body).livemode; } catch { console.log('unreadable /v1/balance'); process.exit(2); }
        if (live !== false) { console.log('LIVEMODE'); process.exit(3); }
        process.exit(0);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (e) => { console.log(e.message); process.exit(2); });
    req.end();`;
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 30000 });
  const said = (result.stdout || result.stderr || '').trim();
  if (result.status === 3) throw new Error('[stripe-sandbox] Stripe reports livemode: true — refusing to run');
  if (result.status !== 0) return `Stripe test mode not reachable (${said || `exit ${result.status}`})`;
  return null;
}

const SKIP_REASON = sandboxSkipReason();
if (SKIP_REASON && process.env.STRIPE_SANDBOX === '1') process.stdout.write(`[stripe-sandbox] skipped: ${SKIP_REASON}\n`);
const describeIfSandbox = SKIP_REASON ? describe.skip : describe;

const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (line: string) => process.stdout.write(`${line}\n`);

type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN';
type Result = { id: string; title: string; status: Status; detail: string };
type StripeCall = { client: string; method: string; ok: boolean; id?: string; error?: string };

class Blocked extends Error {}

/** Stripe's own error, as returned: type, code, HTTP status, message, request id. */
function describeError(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) {
    return `Stripe ${err.type}${err.code ? ` (${err.code})` : ''} HTTP ${err.statusCode ?? '?'}: ${err.message}${err.requestId ? ` [${err.requestId}]` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

describeIfSandbox('Stripe sandbox: the real integration against Stripe test mode', () => {
  const runId = `sbx-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 4)}`;
  const runStart = Math.floor(Date.now() / 1000) - 5;
  const su = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  // Built while Jest collects tests, even when the suite is skipped; the placeholder
  // only stops the SDK throwing then, and is never sent (no test runs without a key).
  const harness = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_unset', { httpAgent: stripeProxyAgent() } as Stripe.StripeConfig);

  let app: INestApplication;
  let platformAccountId = '';
  /** The School's "connected account" for the money flows (see the header). */
  let schoolAccount = '';
  const on = () => ({ stripeAccount: schoolAccount });

  const results: Result[] = [];
  const calls: StripeCall[] = [];
  const created: Record<string, string[]> = {};
  const findings: string[] = [];
  const keep = (kind: string, id: string | undefined | null) => {
    if (!id) return;
    const list = (created[kind] ??= []);
    if (!list.includes(id)) list.push(id);
  };
  let testClock: string | null = null;
  const testClocks: string[] = [];

  // ---- recording wrapper around the app's own Stripe clients ----------------
  const TAGGED = new Set([
    'customers.create',
    'products.create',
    'prices.create',
    'paymentIntents.create',
    'subscriptions.create',
    'checkout.sessions.create',
    'refunds.create',
    'accounts.create',
  ]);
  function wrapStripe<T extends object>(target: T, client: string, path: string[] = []): T {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        if (typeof prop === 'symbol') return value;
        const here = [...path, prop];
        if (typeof value === 'function') {
          return (...args: any[]) => {
            const method = here.join('.');
            if (TAGGED.has(method) && args[0] && typeof args[0] === 'object') {
              args[0] = { ...args[0], metadata: { ...(args[0].metadata ?? {}), ultm8_sandbox_run: runId } };
            }
            if (method === 'customers.create' && testClock) {
              args[0] = { ...(args[0] ?? {}), test_clock: testClock };
            }
            const res = value.apply(obj, args);
            if (res && typeof res.then === 'function') {
              return res.then(
                (r: { id?: string; object?: string }) => {
                  calls.push({ client, method, ok: true, id: r?.id });
                  if (method.endsWith('.create') && r?.id) keep(r.object ?? method, r.id);
                  return r;
                },
                (e: unknown) => {
                  calls.push({ client, method, ok: false, error: describeError(e) });
                  throw e;
                },
              );
            }
            return res;
          };
        }
        if (value && typeof value === 'object' && here.length < 3 && !Array.isArray(value)) {
          return wrapStripe(value as object, client, here);
        }
        return value;
      },
    });
  }
  const callsSince = (n: number) => calls.slice(n);
  const failedCallsSince = (n: number) =>
    callsSince(n)
      .filter((c) => !c.ok)
      .map((c) => `${c.client} ${c.method} -> ${c.error}`);

  // ---- result recording ------------------------------------------------------
  async function step(id: string, title: string, fn: () => Promise<string | void>) {
    const mark = calls.length;
    try {
      const detail = (await fn()) ?? '';
      results.push({ id, title, status: 'PASS', detail });
    } catch (err) {
      const stripeErrors = failedCallsSince(mark);
      const detail = [describeError(err), ...stripeErrors.map((e) => `Stripe call failed: ${e}`)].join(' | ');
      if (err instanceof Blocked) {
        results.push({ id, title, status: 'BLOCKED', detail });
        return;
      }
      results.push({ id, title, status: 'FAIL', detail });
      throw err;
    }
  }
  const notRun = (id: string, title: string, why: string) => results.push({ id, title, status: 'NOT RUN', detail: why });
  function check(cond: unknown, what: string): asserts cond {
    if (!cond) throw new Error(what);
  }
  function expectStatus(res: request.Response, status: number, what: string) {
    if (res.status !== status) throw new Error(`${what}: expected HTTP ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
  }

  // ---- fixtures --------------------------------------------------------------
  const http = () => request(app.getHttpServer());
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};
  let school: { id: string };
  let owner: { id: string; email: string };
  let paymentAccountId = '';
  let pack: { id: string; price: number; title: string };
  let weekly: { id: string; price: number };
  let monthly: { id: string; price: number };
  const SURCHARGE_BPS = 200;

  const sign = (user: { id: string; email: string }, role: string | null, ids: { schoolId?: string | null; franchiseId?: string | null } = {}) =>
    jwt.sign({
      sub: user.id,
      email: user.email,
      grants: role ? [{ role, franchiseId: ids.franchiseId ?? null, schoolId: ids.schoolId ?? null, branchId: null }] : [],
    });
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}, headers: Record<string, string> = {}) => {
      let req = http().post(url).set('Authorization', `Bearer ${token}`);
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
      return req.send(body);
    },
  });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `${runId}-${label}@example.com`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Sandbox',
        passcodeHash: await bcrypt.hash('246810', 4),
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function mkStudent(label: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
    tokens[label] = sign(user, 'STUDENT', { schoolId: school.id });
    return user;
  }
  async function stepUp(label: string) {
    const res = await as(tokens[label]).post('/v1/auth/step-up/verify', { passcode: '246810' });
    expectStatus(res, 201, 'step-up');
    return res.body.stepUpToken as string;
  }
  /** What the checkout.session.completed (mode: setup) handler leaves behind,
   * made directly: completing hosted Checkout needs a browser (step 8). */
  async function saveCard(studentId: string, email: string, testPm: string, autoPayCharges = false) {
    const customer = await harness.customers.create({ email, metadata: { ultm8_sandbox_run: runId } }, on());
    keep('customer', customer.id);
    const pm = await harness.paymentMethods.attach(testPm, { customer: customer.id }, on());
    await harness.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } }, on());
    await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId, schoolId: school.id, stripeCustomerId: customer.id, autoPayCharges } });
    return { customerId: customer.id, paymentMethodId: pm.id };
  }

  // ---- webhooks: real events, signed locally, through the real endpoint ------
  async function findEvent(type: string, match: (object: any) => boolean, timeoutMs = 90_000): Promise<Stripe.Event> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const page = await harness.events.list({ type, created: { gte: runStart }, limit: 100 }, on());
      const found = page.data.find((e) => match(e.data.object));
      if (found) return found;
      await sleep(2000);
    }
    throw new Error(`No ${type} event from Stripe within ${timeoutMs / 1000}s`);
  }
  async function deliver(event: Stripe.Event): Promise<void> {
    // Connect stamps the connected account on each event it sends; these are
    // the platform's own events (see the header), so the School's id is added.
    const payload = JSON.stringify({ ...event, account: event.account ?? schoolAccount });
    const header = harness.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const res = await http().post('/v1/payments/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(payload);
    expectStatus(res, 200, `webhook POST of ${event.type} ${event.id}`);
    const queue = app.get(getQueueToken(STRIPE_WEBHOOK_PROCESSING_QUEUE));
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await su.processedStripeEvent.findUnique({ where: { stripeEventId: event.id } })) return;
      const jobs = await queue.getJobs(['failed', 'delayed', 'waiting', 'active']);
      const job = jobs.find((j: { data?: { stripeEventId?: string } }) => j?.data?.stripeEventId === event.id);
      if (job?.failedReason) throw new Error(`The app's webhook job failed on ${event.type} ${event.id}: ${job.failedReason}`);
      await sleep(500);
    }
    throw new Error(`${event.type} ${event.id} was not processed within 60s`);
  }

  async function intentOf(invoiceId: string): Promise<string> {
    const invoice = await harness.invoices.retrieve(invoiceId, { expand: ['payments'] }, on());
    const ref = invoice.payments?.data.find((p) => p.payment.type === 'payment_intent')?.payment.payment_intent;
    const id = typeof ref === 'string' ? ref : ref?.id;
    check(id, `invoice ${invoiceId} has no PaymentIntent`);
    return id;
  }

  beforeAll(async () => {
    // Test mode or nothing.
    check(!process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_'), 'STRIPE_SECRET_KEY is a live key — refusing to run');
    const balance = await harness.balance.retrieve();
    check(balance.livemode === false, `Stripe reports livemode=${balance.livemode} — refusing to run`);
    const platform = await harness.accounts.retrieveCurrent();
    platformAccountId = platform.id;
    schoolAccount = platform.id;
    out(`[stripe-sandbox] run ${runId} against platform ${platformAccountId} (livemode false)`);

    // Connect onboarding needs return/refresh URLs; Stripe only checks they are
    // URLs, and nobody follows them here.
    process.env.STRIPE_CONNECT_RETURN_URL ||= 'https://example.com/ultm8-sandbox/connect/return';
    process.env.STRIPE_CONNECT_REFRESH_URL ||= 'https://example.com/ultm8-sandbox/connect/refresh';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    const stripeClient = app.get(StripeClientService);
    const platformClient = stripeClient.platformClient.bind(stripeClient);
    const scopedClient = stripeClient.scopedClient.bind(stripeClient);
    stripeClient.platformClient = () => wrapStripe(platformClient(), 'app:platform');
    stripeClient.scopedClient = (accountId: string) => wrapStripe(scopedClient(accountId), `app:scoped(${accountId})`);

    await su.cardSurchargeCountry.upsert({ where: { countryCode: 'GB' }, create: { countryCode: 'GB' }, update: {} });
    school = await su.school.create({
      data: {
        id: randomUUID(),
        name: `Stripe Sandbox School ${runId}`,
        defaultCurrency: 'GBP',
        addressCountry: 'GB',
        timezone: 'UTC',
        cardSurchargeEnabled: true,
        cardSurchargeBps: SURCHARGE_BPS,
      },
    });
    owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens.owner = sign(owner, 'SCHOOL_OWNER_MANAGER', { schoolId: school.id });
    pack = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: `Sandbox 10-Class Pack ${runId}`, price: 2500, classesIncluded: 10, currency: 'GBP' },
    });
    weekly = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'WEEKLY_PASS', title: `Sandbox Weekly Pass ${runId}`, price: 1500, expiryDurationDays: 7, currency: 'GBP' },
    });
    monthly = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: `Sandbox Monthly ${runId}`, price: 4000, currency: 'GBP' },
    });
  });

  afterAll(async () => {
    for (const id of testClocks) {
      try {
        await harness.testHelpers.testClocks.del(id, {}, on());
        findings.push(`cleanup: deleted test clock ${id} (and its customers/subscriptions)`);
      } catch (err) {
        findings.push(`cleanup: FAILED to delete test clock ${id}: ${describeError(err)}`);
      }
    }
    const report = { runId, platformAccountId, schoolAccount, results, findings, created, stripeCalls: calls };
    const file = process.env.STRIPE_SANDBOX_REPORT ?? join(tmpdir(), `stripe-sandbox-${runId}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    out('\n[stripe-sandbox] RESULTS');
    for (const r of results) out(`  ${r.status.padEnd(8)} ${r.id.padEnd(5)} ${r.title}${r.detail ? `\n           ${r.detail}` : ''}`);
    out(`[stripe-sandbox] findings:\n  ${findings.join('\n  ')}`);
    out(`[stripe-sandbox] created: ${JSON.stringify(created)}`);
    out(`[stripe-sandbox] report written to ${file}`);
    await app?.close();
    await su.$disconnect();
  });

  // ===========================================================================
  // 1. Webhook signature
  // ===========================================================================
  it('1. webhook signature: accepts a locally signed real event, rejects a bad signature', async () => {
    await step('1a', 'constructWebhookEvent accepts a locally signed real Stripe event', async () => {
      const marker = await harness.paymentIntents.create(
        { amount: 100, currency: 'gbp', payment_method: 'pm_card_visa', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' }, metadata: { ultm8_sandbox_run: runId } },
        on(),
      );
      keep('payment_intent', marker.id);
      const event = await findEvent('payment_intent.succeeded', (o) => o.id === marker.id);
      const payload = JSON.stringify(event);
      const header = harness.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const parsed = app.get(StripeClientService).constructWebhookEvent(payload, header);
      check(parsed.id === event.id && parsed.type === 'payment_intent.succeeded', 'parsed event does not match');
      return `event ${event.id}`;
    });
    await step('1b', 'constructWebhookEvent and the HTTP endpoint reject a bad signature', async () => {
      const payload = JSON.stringify({ id: `evt_forged_${runId}`, object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_forged' } } });
      const bad = harness.webhooks.generateTestHeaderString({ payload, secret: 'whsec_not_the_apps_secret' });
      let threw: unknown;
      try {
        app.get(StripeClientService).constructWebhookEvent(payload, bad);
      } catch (err) {
        threw = err;
      }
      check(threw instanceof Stripe.errors.StripeSignatureVerificationError, `expected StripeSignatureVerificationError, got ${describeError(threw)}`);
      const res = await http().post('/v1/payments/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', bad).send(payload);
      expectStatus(res, 400, 'forged webhook');
      const tampered = await http()
        .post('/v1/payments/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', harness.webhooks.generateTestHeaderString({ payload, secret: webhookSecret }))
        .send(payload.replace('pi_forged', 'pi_tampered'));
      expectStatus(tampered, 400, 'tampered webhook body');
      return `HTTP 400 ${JSON.stringify(res.body)}`;
    });
  });

  // ===========================================================================
  // 2. Connect onboarding
  // ===========================================================================
  it('2. Connect: the app\'s Express onboarding against real Stripe', async () => {
    await step('2a', 'POST /payment-accounts/:id/connect/onboard creates an Express account + Account Link', async () => {
      const created = await as(tokens.owner).post(`/v1/schools/${school.id}/payment-accounts`, { provider: 'STRIPE', accountTitle: 'Sandbox Card', country: 'GB' });
      expectStatus(created, 201, 'create PaymentAccount');
      paymentAccountId = created.body.id;
      const res = await as(tokens.owner).post(`/v1/payment-accounts/${paymentAccountId}/connect/onboard`);
      const row = await su.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } });
      keep('account', row.stripeConnectedAccountId);
      expectStatus(res, 201, 'onboard');
      check(/^https:\/\/connect\.stripe\.com\//.test(res.body.onboardingUrl), `unexpected onboardingUrl ${res.body.onboardingUrl}`);
      check(row.stripeConnectedAccountId?.startsWith('acct_'), 'no stripeConnectedAccountId stored');
      return `account ${row.stripeConnectedAccountId}, link ${res.body.onboardingUrl}`;
    }).catch(() => undefined);

    let v2Account = '';
    await step('2b', 'a test connected account that can take charges (Accounts v2, API only)', async () => {
      const account = await (harness as any).v2.core.accounts.create({
        contact_email: `${runId}-school@example.com`,
        display_name: `ULTM8 Sandbox ${runId}`,
        identity: {
          country: 'GB',
          entity_type: 'individual',
          individual: {
            given_name: 'Jenny',
            surname: 'Rosen',
            email: `${runId}-school@example.com`,
            date_of_birth: { day: 1, month: 1, year: 1901 },
            address: { line1: 'address_full_match', city: 'London', postal_code: 'WC2N 5DU', country: 'GB' },
          },
        },
        dashboard: 'none',
        defaults: {
          currency: 'gbp',
          responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
          profile: { business_url: 'https://accessible.stripe.com', product_description: 'Martial arts classes' },
        },
        configuration: { merchant: { mcc: '7997', capabilities: { card_payments: { requested: true } } } },
        include: ['configuration.merchant', 'requirements'],
        metadata: { ultm8_sandbox_run: runId },
      });
      v2Account = account.id;
      keep('account', account.id);
      const v1 = await harness.accounts.retrieve(account.id);
      const due = (account.requirements?.entries ?? []).map((e: { description: string; awaiting_action_from: string }) => `${e.description} (${e.awaiting_action_from})`);
      if (!v1.charges_enabled) {
        let chargeError = '';
        try {
          await harness.paymentIntents.create(
            { amount: 100, currency: 'gbp', payment_method: 'pm_card_visa', confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: 'never' } },
            { stripeAccount: account.id },
          );
        } catch (err) {
          chargeError = describeError(err);
        }
        throw new Blocked(
          `${account.id} created, but charges_enabled=false: Stripe owns requirement collection on this platform, so its Terms of Service can only be accepted by the account holder in Stripe-hosted onboarding (a browser; connect.stripe.com is not reachable from here). Still due: ${due.join('; ')}. A charge on it: ${chargeError || 'succeeded?'}`,
        );
      }
      schoolAccount = account.id;
      return `${account.id} charges_enabled`;
    });

    await step('2c', 'onboarding an existing account re-issues an Account Link (accountLinks.create on a v2 account)', async () => {
      check(v2Account, 'no v2 account from 2b');
      const franchise = await su.franchise.create({ data: { id: randomUUID(), name: `Sandbox Franchise ${runId}`, feeModel: 'FLAT', flatFeeAmount: 5000 } });
      const fOwner = await mkUser('franchiseOwner');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: fOwner.id, franchiseId: franchise.id } });
      tokens.franchiseOwner = sign(fOwner, 'FRANCHISE_OWNER', { franchiseId: franchise.id });
      const account = await su.paymentAccount.create({
        data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Sandbox Franchise', country: 'GB', stripeConnectedAccountId: v2Account },
      });
      const status = await as(tokens.franchiseOwner).get(`/v1/franchises/${franchise.id}/payment-account/connect-status`);
      expectStatus(status, 200, 'connect-status');
      check(status.body.status === 'ACTION_NEEDED', `connect-status ${JSON.stringify(status.body)} (expected ACTION_NEEDED for an account still owing requirements)`);
      const res = await as(tokens.franchiseOwner).post(`/v1/payment-accounts/${account.id}/connect/onboard`);
      expectStatus(res, 201, 'onboard existing account');
      check(/^https:\/\/connect\.stripe\.com\//.test(res.body.onboardingUrl), `unexpected onboardingUrl ${res.body.onboardingUrl}`);
      return `connect-status ACTION_NEEDED; link ${res.body.onboardingUrl}`;
    }).catch(() => undefined);

    // The money flows need an account that can take charges.
    if (schoolAccount === platformAccountId) {
      findings.push(
        `money flows (3-8) run on the platform account ${platformAccountId} as the School's connected account: no connected account can take charges without browser onboarding (2b)`,
      );
    }
    if (paymentAccountId) {
      await su.paymentAccount.update({ where: { id: paymentAccountId }, data: { stripeConnectedAccountId: schoolAccount } });
    } else {
      paymentAccountId = (
        await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Sandbox Card', country: 'GB', stripeConnectedAccountId: schoolAccount } })
      ).id;
    }
  });

  // ===========================================================================
  // 3. Saved-card purchase (+ receipt, + getMyPaymentMethod)
  // ===========================================================================
  it('3. Membership purchase with a saved card (off-session) on the connected account', async () => {
    const student = await mkStudent('savedCard');
    const saved = await saveCard(student.id, student.email, 'pm_card_visa');
    let transactionId = '';
    let intentId = '';
    await step('3a', 'saved-card Class Pack purchase: SUCCESSFUL Transaction, Membership, PaymentIntent with surcharge', async () => {
      const res = await as(tokens.savedCard).post(`/v1/membership-plans/${pack.id}/purchase`, { payWithSavedCard: true }, { 'X-Step-Up-Token': await stepUp('savedCard') });
      expectStatus(res, 201, 'purchase');
      check(res.body.outcome === 'active', `outcome ${res.body.outcome}`);
      transactionId = res.body.transactionId;
      const tx = await su.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      const surcharge = Math.floor((pack.price * SURCHARGE_BPS + 5000) / 10000);
      check(tx.status === 'SUCCESSFUL', `Transaction ${tx.status}`);
      check(tx.amount === pack.price && tx.surchargeAmount === surcharge && tx.currency === 'GBP', `Transaction ${tx.amount}/${tx.surchargeAmount}/${tx.currency}`);
      check(tx.membershipId, 'Transaction has no Membership');
      const membership = await su.membership.findUniqueOrThrow({ where: { id: tx.membershipId } });
      check(membership.status === 'ACTIVE' && membership.classesRemaining === 10, `Membership ${membership.status} ${membership.classesRemaining}`);
      intentId = tx.stripePaymentIntentId!;
      const pi = await harness.paymentIntents.retrieve(intentId, {}, on());
      check(pi.status === 'succeeded', `PaymentIntent ${pi.status}`);
      check(pi.amount === pack.price + surcharge && pi.currency === 'gbp', `PaymentIntent ${pi.amount} ${pi.currency}`);
      check(pi.customer === saved.customerId && pi.payment_method === saved.paymentMethodId, 'PaymentIntent not on the saved customer/card');
      return `${intentId}: ${pi.amount} ${pi.currency} (price ${pack.price} + surcharge ${surcharge}), Transaction ${transactionId}, Membership ${membership.id}; PaymentIntent metadata ${JSON.stringify(pi.metadata)}`;
    });
    await step('3b', 'payment_intent.succeeded for the saved-card charge changes nothing (already SUCCESSFUL)', async () => {
      check(intentId, 'no PaymentIntent from 3a');
      await deliver(await findEvent('payment_intent.succeeded', (o) => o.id === intentId));
      const tx = await su.transaction.findUniqueOrThrow({ where: { id: transactionId } });
      const memberships = await su.membership.count({ where: { studentId: student.id } });
      check(tx.status === 'SUCCESSFUL' && memberships === 1, `Transaction ${tx.status}, ${memberships} Memberships`);
    });
    await step('8a', 'GET /transactions/:id/invoice returns the Stripe receipt (getReceiptUrl)', async () => {
      check(transactionId, 'no Transaction from 3a');
      const res = await as(tokens.savedCard).get(`/v1/transactions/${transactionId}/invoice`);
      expectStatus(res, 200, 'receipt');
      check(typeof res.body.receiptUrl === 'string' && res.body.receiptUrl.startsWith('https://pay.stripe.com/receipts/'), `receiptUrl ${res.body.receiptUrl}`);
      return res.body.receiptUrl;
    });
    await step('8b', 'GET /schools/:id/payment-methods/me reads the saved card from Stripe', async () => {
      const res = await as(tokens.savedCard).get(`/v1/schools/${school.id}/payment-methods/me`);
      expectStatus(res, 200, 'payment-methods/me');
      check(res.body.hasSavedPaymentMethod && res.body.brand === 'visa' && res.body.last4 === '4242', JSON.stringify(res.body));
      return JSON.stringify(res.body);
    });
  });

  // ===========================================================================
  // 4. Hosted Checkout
  // ===========================================================================
  it('4. Hosted Checkout purchase: the Checkout Session on the connected account', async () => {
    const student = await mkStudent('hosted');
    await step('4a', 'useHostedCheckout creates a Checkout Session with the right lines/amount/currency/metadata', async () => {
      const mark = calls.length;
      const res = await as(tokens.hosted).post(`/v1/membership-plans/${pack.id}/purchase`, { useHostedCheckout: true });
      const sessionCall = callsSince(mark).find((c) => c.method === 'checkout.sessions.create' && c.ok);
      let lines = '';
      if (sessionCall?.id) {
        const session = await harness.checkout.sessions.retrieve(sessionCall.id, {}, on());
        const items = await harness.checkout.sessions.listLineItems(sessionCall.id, {}, on());
        lines = `session ${session.id}: amount_total ${session.amount_total} ${session.currency}, payment_intent ${session.payment_intent ?? 'null'}, lines ${JSON.stringify(
          items.data.map((l) => [l.description, l.amount_total]),
        )}, metadata ${JSON.stringify(session.metadata)}`;
        const surcharge = Math.floor((pack.price * SURCHARGE_BPS + 5000) / 10000);
        check(session.amount_total === pack.price + surcharge && session.currency === 'gbp', `wrong amount: ${lines}`);
      }
      if (res.status !== 201) throw new Error(`purchase: HTTP ${res.status} ${JSON.stringify(res.body)}; ${lines}`);
      check(res.body.outcome === 'requires_checkout' && /^https:\/\/checkout\.stripe\.com\//.test(res.body.checkoutUrl), JSON.stringify(res.body));
      const tx = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
      check(tx.status === 'PENDING' && tx.stripePaymentIntentId, `Transaction ${tx.status} ${tx.stripePaymentIntentId}`);
      return lines;
    });
    await step('4b', 'completing the hosted Checkout page', async () => {
      throw new Blocked('checkout.stripe.com (and js.stripe.com) are refused by this environment\'s egress proxy (connect_rejected), so the hosted page cannot be loaded or completed with Playwright');
    });
    void student;
  });

  // ===========================================================================
  // 5. Charges: auto-pay success/failure, refund to card, charge.refunded
  // ===========================================================================
  it('5. Charges (backlog 3.6): automatic payment, decline, refund to card, charge.refunded', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const autoPay = app.get(ChargeAutoPayProcessor);
    const createCharge = async (studentId: string, amount: number, description: string) => {
      const res = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${studentId}/charges`, { description, amount, dueDate: today });
      expectStatus(res, 201, 'create charge');
      return res.body as { id: string };
    };
    const good = await mkStudent('autoPayOk');
    await saveCard(good.id, good.email, 'pm_card_visa', true);
    const paid: { tx?: { id: string; stripePaymentIntentId: string | null; amount: number } } = {};

    await step('5a', 'charge-auto-pay pays a due charge with the saved card (pm_card_visa)', async () => {
      const charge = await createCharge(good.id, 3000, `Sandbox rash guard ${runId}`);
      const outcome = await autoPay.run(new Date());
      const tx = await su.transaction.findFirst({ where: { chargeId: charge.id, chargePaymentChannel: 'AUTOMATIC' } });
      check(tx, `no AUTOMATIC payment (run outcome ${JSON.stringify(outcome)})`);
      check(tx.status === 'SUCCESSFUL', `Transaction ${tx.status} (run outcome ${JSON.stringify(outcome)})`);
      const pi = await harness.paymentIntents.retrieve(tx.stripePaymentIntentId!, {}, on());
      const surcharge = Math.floor((3000 * SURCHARGE_BPS + 5000) / 10000);
      check(pi.status === 'succeeded' && pi.amount === 3000 + surcharge && pi.currency === 'gbp', `PaymentIntent ${pi.status} ${pi.amount} ${pi.currency}`);
      const c = await su.charge.findUniqueOrThrow({ where: { id: charge.id }, include: { allocations: true } });
      const allocated = c.allocations.reduce((n, a) => n + a.amount, 0);
      check(allocated === 3000, `allocated ${allocated}`);
      paid.tx = tx;
      return `${pi.id}: ${pi.amount} ${pi.currency} (3000 + surcharge ${surcharge}); Transaction ${tx.id}; run ${JSON.stringify(outcome)}`;
    });

    await step('5b', 'charge-auto-pay with a declining card (pm_card_chargeCustomerFail): FAILED, failed-payment notice', async () => {
      const bad = await mkStudent('autoPayFail');
      await saveCard(bad.id, bad.email, 'pm_card_chargeCustomerFail', true);
      const charge = await createCharge(bad.id, 2000, `Sandbox gloves ${runId}`);
      const outcome = await autoPay.run(new Date());
      const tx = await su.transaction.findFirst({ where: { chargeId: charge.id, chargePaymentChannel: 'AUTOMATIC' } });
      check(tx, `no AUTOMATIC attempt (run outcome ${JSON.stringify(outcome)})`);
      check(tx.status === 'FAILED', `Transaction ${tx.status}`);
      check(tx.stripePaymentIntentId, 'FAILED Transaction has no PaymentIntent id');
      const pi = await harness.paymentIntents.retrieve(tx.stripePaymentIntentId, {}, on());
      const lastError = pi.last_payment_error ? `${pi.last_payment_error.code}/${pi.last_payment_error.decline_code}` : 'none';
      let notice: { body: string } | null = null;
      for (let i = 0; i < 40 && !notice; i++) {
        notice = await su.notification.findFirst({ where: { userId: bad.id, type: 'CHARGE', title: 'Automatic payment failed' } });
        if (!notice) await sleep(250);
      }
      check(notice, 'no "Automatic payment failed" notification');
      const c = await su.charge.findUniqueOrThrow({ where: { id: charge.id }, include: { allocations: true } });
      check(c.allocations.length === 0, 'declined payment allocated to the charge');
      return `${pi.id} ${pi.status} (${lastError}); Transaction ${tx.id} FAILED; notice "${notice.body}"`;
    });

    let refundId = '';
    await step('5c', 'owner refunds part of the automatic payment to the CARD: a real Stripe refund, records match', async () => {
      const paidTx = paid.tx;
      check(paidTx?.stripePaymentIntentId, 'no paid automatic payment from 5a');
      const res = await as(tokens.owner).post(`/v1/schools/${school.id}/charge-payments/${paidTx.id}/refund`, { amount: 1000, destination: 'CARD', notes: `sandbox ${runId}` });
      expectStatus(res, 201, 'refund');
      const rows = await su.chargeRefund.findMany({ where: { transactionId: paidTx.id } });
      check(rows.length === 1 && rows[0].amount === 1000 && rows[0].stripeRefundId, `ChargeRefund rows ${JSON.stringify(rows)}`);
      refundId = rows[0].stripeRefundId!;
      const refund = await harness.refunds.retrieve(refundId, {}, on());
      check(refund.amount === 1000 && refund.currency === 'gbp' && refund.payment_intent === paidTx.stripePaymentIntentId, `Refund ${refund.amount} ${refund.currency} ${refund.payment_intent}`);
      check(refund.status === 'succeeded' || refund.status === 'pending', `Refund status ${refund.status}`);
      const tx = await su.transaction.findUniqueOrThrow({ where: { id: paidTx.id } });
      return `refund ${refund.id} ${refund.amount} ${refund.currency} ${refund.status}; Transaction ${tx.status} refundedAmount ${tx.refundedAmount}`;
    });

    await step('5d', 'the charge.refunded webhook for that refund does not double-count', async () => {
      const paidTx = paid.tx;
      check(refundId && paidTx?.stripePaymentIntentId, 'no refund from 5c');
      const before = await su.transaction.findUniqueOrThrow({ where: { id: paidTx.id } });
      const event = await findEvent('charge.refunded', (o) => o.payment_intent === paidTx.stripePaymentIntentId);
      await deliver(event);
      const after = await su.transaction.findUniqueOrThrow({ where: { id: paidTx.id } });
      const rows = await su.chargeRefund.count({ where: { transactionId: paidTx.id } });
      check(after.refundedAmount === before.refundedAmount && after.status === before.status && rows === 1, `before ${before.status}/${before.refundedAmount}, after ${after.status}/${after.refundedAmount}, ${rows} ChargeRefund rows`);
      return `event ${event.id}: Transaction stays ${after.status}, refundedAmount ${after.refundedAmount}, 1 ChargeRefund`;
    });
  });

  // ===========================================================================
  // 6. Subscription renewal with a test clock
  // ===========================================================================
  it('6. Subscription renewal with a Stripe test clock (success, failure, late fee)', async () => {
    // Decision 406 (backlog 3.8): the School's card surcharge is on, so each
    // Subscription carries it as its own monthly item, and the first payment
    // and every renewal record it apart from the plan's price.
    const monthlySurcharge = Math.floor((monthly.price * SURCHARGE_BPS + 5000) / 10000);
    const clock = await harness.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: runId }, on());
    testClocks.push(clock.id);
    keep('test_clock', clock.id);
    // One clock for both subscribers: a clock holds at most 3 customers.

    type Sub = { label: string; studentId: string; subscriptionId: string; customerId: string; transactionId: string; intentId: string };
    const subs: Sub[] = [];

    /** The app's own subscribe path; if it can't, the same Subscription made by
     * hand (recorded as a FAIL first) so the renewal handling can still be run. */
    async function subscribe(label: string, stepId: string): Promise<Sub> {
      const student = await mkStudent(label);
      testClock = clock.id;
      const mark = calls.length;
      let res: request.Response;
      try {
        res = await as(tokens[label]).post(`/v1/membership-plans/${monthly.id}/purchase`, {});
      } finally {
        testClock = null;
      }
      if (res.status === 201) {
        const tx = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
        const sub = await harness.subscriptions.retrieve(tx.stripeSubscriptionId!, {}, on());
        results.push({ id: stepId, title: `the app's SUBSCRIPTION purchase (PaymentsService.subscribe) for ${label}`, status: 'PASS', detail: `${sub.id} on test clock ${clock.id}` });
        return { label, studentId: student.id, subscriptionId: sub.id, customerId: sub.customer as string, transactionId: tx.id, intentId: tx.stripePaymentIntentId! };
      }
      results.push({
        id: stepId,
        title: `the app's SUBSCRIPTION purchase (PaymentsService.subscribe) for ${label}`,
        status: 'FAIL',
        detail: `HTTP ${res.status} ${JSON.stringify(res.body)} | ${failedCallsSince(mark).join(' | ')}`,
      });
      // The app's subscribe() does create the Customer (on the test clock),
      // Product and Subscription at Stripe before it fails; that Subscription
      // is carried on with: its first invoice's PaymentIntent read from
      // `payments`, and the PENDING Transaction purchase() would have written.
      const appSubscriptionId = callsSince(mark).filter((c) => c.method === 'subscriptions.create' && c.ok).pop()?.id;
      check(appSubscriptionId, 'the app created no Stripe Subscription to carry on with');
      const sub = await harness.subscriptions.retrieve(appSubscriptionId, {}, on());
      const customer = { id: sub.customer as string };
      findings.push(`6 (${label}): the app's own Subscription ${sub.id} (${sub.status}) carried on with by the harness after its HTTP ${res.status}`);
      const intentId = await intentOf(sub.latest_invoice as string);
      const transactionId = randomUUID();
      await su.transaction.create({
        data: {
          id: transactionId,
          schoolId: school.id,
          studentId: student.id,
          paymentAccountId,
          membershipPlanId: monthly.id,
          amount: monthly.price,
          currency: 'GBP',
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: intentId,
          stripeSubscriptionId: sub.id,
        },
      });
      return { label, studentId: student.id, subscriptionId: sub.id, customerId: customer.id, transactionId, intentId };
    }

    for (const [label, stepId] of [['renewOk', '6a'], ['renewFail', '6a2']] as const) {
      const sub = await subscribe(label, stepId);
      subs.push(sub);
      // The app's client confirms the first invoice's PaymentIntent with the card.
      await harness.paymentIntents.confirm(sub.intentId, { payment_method: 'pm_card_visa', return_url: 'https://example.com/return' }, on());
    }

    await step('6b', 'first payment: payment_intent.succeeded creates the Subscription Membership; invoice.paid (subscription_create) adds no RENEWAL', async () => {
      const lines: string[] = [];
      for (const sub of subs) {
        await deliver(await findEvent('payment_intent.succeeded', (o) => o.id === sub.intentId));
        const tx = await su.transaction.findUniqueOrThrow({ where: { id: sub.transactionId } });
        check(tx.status === 'SUCCESSFUL' && tx.membershipId, `${sub.label}: Transaction ${tx.status} membership ${tx.membershipId}`);
        const stripeSub = await harness.subscriptions.retrieve(sub.subscriptionId, {}, on());
        check(
          stripeSub.items.data.length === 2 && stripeSub.metadata.cardSurchargeBps === String(SURCHARGE_BPS) && stripeSub.metadata.surchargeAmount === String(monthlySurcharge),
          `${sub.label}: ${stripeSub.items.data.length} Subscription items, metadata ${JSON.stringify(stripeSub.metadata)}`,
        );
        check(tx.amount === monthly.price && tx.surchargeAmount === monthlySurcharge, `${sub.label}: first payment ${tx.amount} + surcharge ${tx.surchargeAmount}`);
        const m = await su.membership.findUniqueOrThrow({ where: { id: tx.membershipId } });
        check(m.stripeSubscriptionId === sub.subscriptionId && m.status === 'ACTIVE', `${sub.label}: Membership ${m.status} ${m.stripeSubscriptionId}`);
        const firstInvoice = (await harness.subscriptions.retrieve(sub.subscriptionId, {}, on())).latest_invoice as string;
        await deliver(await findEvent('invoice.paid', (o) => o.id === firstInvoice));
        const renewals = await su.transaction.count({ where: { studentId: sub.studentId, kind: 'RENEWAL' } });
        check(renewals === 0, `${sub.label}: ${renewals} RENEWAL rows after the first invoice`);
        lines.push(`${sub.label}: ${sub.subscriptionId} Membership ${m.id}`);
      }
      return lines.join('; ');
    });

    const failing = subs.find((s) => s.label === 'renewFail')!;
    const failPm = await harness.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: failing.customerId }, on());
    await harness.customers.update(failing.customerId, { invoice_settings: { default_payment_method: failPm.id } }, on());
    await harness.subscriptions.update(failing.subscriptionId, { default_payment_method: failPm.id }, on());

    const anySub = await harness.subscriptions.retrieve(subs[0].subscriptionId, {}, on());
    const periodEnd = anySub.items.data[0].current_period_end;
    await step('6c', 'advance the test clock past the period end; Stripe finalises and attempts the renewal invoices', async () => {
      await harness.testHelpers.testClocks.advance(clock.id, { frozen_time: periodEnd + 2 * 60 * 60 }, on());
      for (let i = 0; i < 90; i++) {
        const c = await harness.testHelpers.testClocks.retrieve(clock.id, {}, on());
        if (c.status === 'ready') break;
        if (c.status === 'internal_failure') throw new Error(`test clock ${clock.id} internal_failure`);
        await sleep(2000);
      }
      const c = await harness.testHelpers.testClocks.retrieve(clock.id, {}, on());
      check(c.status === 'ready', `test clock status ${c.status}`);
      return `clock ${clock.id} at ${new Date(c.frozen_time * 1000).toISOString()}`;
    });

    const renewalInvoice = async (subscriptionId: string) => {
      for (let i = 0; i < 30; i++) {
        const list = await harness.invoices.list({ subscription: subscriptionId, limit: 10 }, on());
        const inv = list.data.find((x) => x.billing_reason === 'subscription_cycle' && x.status !== 'draft');
        if (inv) return inv;
        await sleep(2000);
      }
      throw new Error(`no finalised subscription_cycle invoice for ${subscriptionId}`);
    };

    await step('6d', 'invoice.paid for the renewal: RENEWAL Transaction SUCCESSFUL', async () => {
      const ok = subs.find((s) => s.label === 'renewOk')!;
      const inv = await renewalInvoice(ok.subscriptionId);
      check(inv.status === 'paid', `renewal invoice ${inv.id} is ${inv.status}`);
      await deliver(await findEvent('invoice.paid', (o) => o.id === inv.id));
      const tx = await su.transaction.findUnique({ where: { stripeInvoiceId: inv.id } });
      check(tx, `no Transaction for invoice ${inv.id}`);
      check(tx.kind === 'RENEWAL' && tx.status === 'SUCCESSFUL' && tx.amount === monthly.price && tx.currency === 'GBP', `Transaction ${tx.kind} ${tx.status} ${tx.amount} ${tx.currency}`);
      check(tx.surchargeAmount === monthlySurcharge && inv.amount_paid === monthly.price + monthlySurcharge, `surcharge ${tx.surchargeAmount}, invoice paid ${inv.amount_paid}`);
      check(tx.stripePaymentIntentId, 'RENEWAL has no PaymentIntent id');
      return `invoice ${inv.id} -> RENEWAL ${tx.id} ${tx.amount} + surcharge ${tx.surchargeAmount} ${tx.currency}, billingDate ${tx.billingDate?.toISOString()}`;
    });

    const failed: { renewal?: { id: string; billingDate: Date | null } } = {};
    await step('6e', 'invoice.payment_failed for the renewal (pm_card_chargeCustomerFail): RENEWAL Transaction FAILED', async () => {
      const inv = await renewalInvoice(failing.subscriptionId);
      check(inv.status === 'open' && inv.attempt_count >= 1, `renewal invoice ${inv.id} is ${inv.status}, ${inv.attempt_count} attempts`);
      await deliver(await findEvent('invoice.payment_failed', (o) => o.id === inv.id));
      const tx = await su.transaction.findUnique({ where: { stripeInvoiceId: inv.id } });
      check(tx, `no Transaction for invoice ${inv.id}`);
      check(tx.kind === 'RENEWAL' && tx.status === 'FAILED' && tx.amount === monthly.price && tx.surchargeAmount === monthlySurcharge, `Transaction ${tx.kind} ${tx.status} ${tx.amount} + ${tx.surchargeAmount}`);
      failed.renewal = tx;
      const m = await su.membership.findUnique({ where: { stripeSubscriptionId: failing.subscriptionId } });
      return `invoice ${inv.id} -> RENEWAL ${tx.id} FAILED ${tx.amount}; Membership ${m?.status}; subscription ${(await harness.subscriptions.retrieve(failing.subscriptionId, {}, on())).status}`;
    });

    await step('6f', 'late fee on the failed renewal (Decision 413), once grace has passed', async () => {
      const failedRenewal = failed.renewal;
      check(failedRenewal?.billingDate, 'no FAILED renewal from 6e');
      await su.school.update({
        where: { id: school.id },
        data: { lateFeeEnabled: true, lateFeeType: 'FIXED', lateFeeFixedAmount: 500, lateFeeGraceDays: 3, lateFeeEnabledAt: new Date(), lateFeeConfirmedAt: new Date(), lateFeeConfirmedById: owner.id },
      });
      const when = new Date(failedRenewal.billingDate.getTime() + 4 * DAY_MS);
      const outcome = await app.get(LateFeeProcessor).run(when, [school.id]);
      const fee = await su.charge.findFirst({ where: { lateFeeForTransactionId: failedRenewal.id } });
      check(fee, `no late fee for RENEWAL ${failedRenewal.id} (run ${JSON.stringify(outcome)} at ${when.toISOString()})`);
      check(fee.grossAmount === 500, `late fee grossAmount ${fee.grossAmount} (net ${fee.netAmount}, tax ${fee.taxAmount})`);
      return `late fee Charge ${fee.id} gross ${fee.grossAmount} ${fee.currency} (run ${JSON.stringify(outcome)} at ${when.toISOString()}; no Stripe call: a late fee is a charge on the member's balance)`;
    });

    await step('6g', 'country removed (Decision 419 item 3): the surcharge item comes off the running Subscription, no proration, metadata cleared; the next invoice has no surcharge line', async () => {
      // Called directly, as the card-surcharge-country-removal job does per
      // Subscription: the allow-list keeps GB for the steps after this one.
      const ok = subs.find((s) => s.label === 'renewOk')!;
      const outcome = await app.get(PaymentsService).removeSubscriptionSurcharge(schoolAccount, ok.subscriptionId, new Date());
      check(outcome === 'removed', `outcome ${outcome}`);
      const after = await harness.subscriptions.retrieve(ok.subscriptionId, {}, on());
      check(after.items.data.length === 1 && !after.metadata.cardSurchargeProduct && !after.metadata.cardSurchargeBps, `${after.items.data.length} items, metadata ${JSON.stringify(after.metadata)}`);
      const preview = await harness.invoices.createPreview({ subscription: ok.subscriptionId }, on());
      check(preview.total === monthly.price, `next invoice ${preview.total} (${preview.lines.data.map((l) => l.amount).join(' + ')})`);
      const again = await app.get(PaymentsService).removeSubscriptionSurcharge(schoolAccount, ok.subscriptionId, new Date());
      check(again === 'none', `re-run outcome ${again}`);
      return `${ok.subscriptionId}: ${after.items.data.length} item, next invoice ${preview.total} ${preview.currency}; re-run ${again}`;
    });
  });

  // ===========================================================================
  // 7. Dispute
  // ===========================================================================
  it('7. Dispute: pm_card_createDispute -> charge.dispute.created -> DISPUTED', async () => {
    const student = await mkStudent('dispute');
    await saveCard(student.id, student.email, 'pm_card_createDispute');
    await step('7a', 'charge.dispute.created marks the Transaction DISPUTED', async () => {
      const res = await as(tokens.dispute).post(`/v1/membership-plans/${pack.id}/purchase`, { payWithSavedCard: true }, { 'X-Step-Up-Token': await stepUp('dispute') });
      expectStatus(res, 201, 'purchase');
      const tx = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
      const event = await findEvent('charge.dispute.created', (o) => o.payment_intent === tx.stripePaymentIntentId);
      await deliver(event);
      const after = await su.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      const dispute = event.data.object as Stripe.Dispute;
      keep('dispute', dispute.id);
      check(after.status === 'DISPUTED' && after.disputedAmount === dispute.amount, `Transaction ${after.status} disputedAmount ${after.disputedAmount} (dispute ${dispute.amount} ${dispute.status})`);
      return `dispute ${dispute.id} (${dispute.amount} ${dispute.currency}, ${dispute.status}) -> Transaction ${tx.id} DISPUTED ${after.disputedAmount}`;
    });
  });

  // ===========================================================================
  // 8. The rest of what calls Stripe
  // ===========================================================================
  it('8. other Stripe callers', async () => {
    await step('8c', 'fresh-card purchase (charge()): PaymentIntent, confirmed by the client, payment_intent.succeeded creates the Membership', async () => {
      const student = await mkStudent('freshCard');
      const res = await as(tokens.freshCard).post(`/v1/membership-plans/${pack.id}/purchase`, {});
      expectStatus(res, 201, 'purchase');
      check(res.body.outcome === 'requires_payment' && res.body.clientSecret, JSON.stringify(res.body));
      const tx = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
      const pi = await harness.paymentIntents.retrieve(tx.stripePaymentIntentId!, {}, on());
      const surcharge = Math.floor((pack.price * SURCHARGE_BPS + 5000) / 10000);
      check(pi.amount === pack.price + surcharge && pi.currency === 'gbp' && pi.metadata.surchargeAmount === String(surcharge), `PaymentIntent ${pi.amount} ${pi.currency} ${JSON.stringify(pi.metadata)}`);
      await harness.paymentIntents.confirm(pi.id, { payment_method: 'pm_card_visa', return_url: 'https://example.com/return' }, on());
      await deliver(await findEvent('payment_intent.succeeded', (o) => o.id === pi.id));
      const after = await su.transaction.findUniqueOrThrow({ where: { id: tx.id } });
      check(after.status === 'SUCCESSFUL' && after.membershipId, `Transaction ${after.status} ${after.membershipId}`);
      void student;
      return `${pi.id} ${pi.amount} ${pi.currency} -> Membership ${after.membershipId}`;
    }).catch(() => undefined);

    await step('8d', 'a saved-card purchase that loses the Membership race is refunded at Stripe (refundOffSessionCharge)', async () => {
      const student = await mkStudent('race');
      await saveCard(student.id, student.email, 'pm_card_visa');
      const payments = app.get(PaymentsService);
      const original = payments.chargeOffSession.bind(payments);
      // The race: another Weekly Pass becomes active between the charge and the
      // Membership being written.
      payments.chargeOffSession = async (...args: Parameters<PaymentsService['chargeOffSession']>) => {
        const result = await original(...args);
        await su.membership.create({
          data: { id: randomUUID(), studentId: student.id, schoolId: school.id, membershipPlanId: weekly.id, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 7 * DAY_MS) },
        });
        return result;
      };
      let res: request.Response;
      try {
        res = await as(tokens.race).post(`/v1/membership-plans/${weekly.id}/purchase`, { payWithSavedCard: true }, { 'X-Step-Up-Token': await stepUp('race') });
      } finally {
        payments.chargeOffSession = original;
      }
      expectStatus(res, 409, 'race purchase');
      const tx = await su.transaction.findFirstOrThrow({ where: { studentId: student.id, membershipPlanId: weekly.id } });
      const refunds = await harness.refunds.list({ payment_intent: tx.stripePaymentIntentId!, limit: 10 }, on());
      const pi = await harness.paymentIntents.retrieve(tx.stripePaymentIntentId!, {}, on());
      check(refunds.data.length === 1 && refunds.data[0].amount === pi.amount, `refunds ${JSON.stringify(refunds.data.map((r) => [r.id, r.amount, r.status]))} for a ${pi.amount} charge`);
      refunds.data.forEach((r) => keep('refund', r.id));
      check(tx.status === 'REFUNDED', `Transaction ${tx.status}`);
      return `${pi.id} ${pi.amount} refunded in full by ${refunds.data[0].id} (${refunds.data[0].status}); Transaction REFUNDED refundedAmount ${tx.refundedAmount}; HTTP 409 "${res.body?.error?.message ?? ''}"`;
    }).catch(() => undefined);

    await step('8e', 'POST /schools/:id/payment-methods/setup-session creates a setup-mode Checkout Session', async () => {
      const res = await as(tokens.freshCard).post(`/v1/schools/${school.id}/payment-methods/setup-session`);
      expectStatus(res, 201, 'setup-session');
      check(/^https:\/\/checkout\.stripe\.com\//.test(res.body.checkoutUrl), res.body.checkoutUrl);
      return `${res.body.checkoutUrl.slice(0, 60)}... (completing it needs a browser: BLOCKED as 4b)`;
    }).catch(() => undefined);

    await step('8f', 'paying charges in the app by hosted Checkout (POST /students/:id/charges/checkout)', async () => {
      const student = await mkStudent('chargeCheckout');
      const charge = await as(tokens.owner).post(`/v1/schools/${school.id}/students/${student.id}/charges`, { description: `Sandbox belt ${runId}`, amount: 1200, dueDate: new Date().toISOString().slice(0, 10) });
      expectStatus(charge, 201, 'create charge');
      const res = await as(tokens.chargeCheckout).post(`/v1/students/${student.id}/charges/checkout`, { schoolId: school.id, chargeId: charge.body.id });
      expectStatus(res, 201, 'charges checkout');
      return JSON.stringify(res.body);
    }).catch(() => undefined);

    await step('8g', 'the platform\'s own SubscriptionPlan purchase (SubscriptionPlansService.subscribe, platform account)', async () => {
      const plan = await su.subscriptionPlan.create({ data: { id: randomUUID(), name: `Sandbox Platform Plan ${runId}`, price: 3000 } });
      const other = await su.school.create({ data: { id: randomUUID(), name: `Stripe Sandbox Platform-Billing School ${runId}`, defaultCurrency: 'GBP', timezone: 'UTC' } });
      const otherOwner = await mkUser('platformOwner');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: other.id, isMainOwner: true } });
      const res = await as(sign(otherOwner, 'SCHOOL_OWNER_MANAGER', { schoolId: other.id })).post(`/v1/schools/${other.id}/subscription-plans/${plan.id}/subscribe`);
      expectStatus(res, 201, 'platform subscribe');
      return JSON.stringify(res.body).slice(0, 200);
    }).catch(() => undefined);

    notRun('8h', 'franchise fee card payments (Decision 407: FranchiseFeeBillingService/FranchiseFeesService)', 'needs a Franchise connected account that can take charges (2b) plus School-as-customer setup Checkout on it (browser); not run');
    notRun('8i', 'Class Pack refund on class cancellation (Decision 291: CancellationService -> PaymentsService.refundPayment)', 'same refunds.create call as 5c (refundPayment), already exercised there; the cancellation flow itself was not run');
    notRun('8j', 'freeze fee / freeze billing pause (freeze-billing.ts), plan price-change migrate (createPriceForPlan / migrateSubscriptionToNewPrice), cancel-subscription, franchise-fee rate migration, tenant close (stop-tenant-billing), platform-admin credential rotation (accountLinks.create)', 'not run in this pass');
  });

  it('summary: no step FAILED', () => {
    const failedSteps = results.filter((r) => r.status === 'FAIL').map((r) => r.id);
    expect(failedSteps).toEqual([]);
  });
});
