/**
 * Decision 437 over real HTTP: Stripe Connect onboarding only where ULTM8's UK
 * platform can onboard the School or Franchise (GB, the EU27, NO, CH, LI, GI).
 * A Brazilian School's or Franchise's onboarding is refused with the
 * translated reason before anything reaches Stripe; a UK or EU one starts; an
 * account already connected elsewhere keeps working. The payment-account,
 * connect-status and Dashboard responses say whether Connect is available,
 * and a Brazilian School's setup checklist leaves the Stripe step out.
 *
 * Stripe is faked (no live key in CI): the fake records accounts.create, so the
 * tests check what WOULD be sent to Stripe — same approach as
 * franchise-card-billing.e2e-spec.ts.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { SERVER_MESSAGE_LOADERS } from '@ultm8/i18n';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-connect-countries.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const REFUSED = "Card payments through Stripe aren't available in this country yet. Members pay by cash or bank transfer, and staff confirm the payment.";

describeIfDb('Stripe Connect only where Stripe can onboard (Decision 437)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const accountsCreate: Array<Record<string, unknown>> = [];
  const accountLinks: unknown[] = [];
  const stripeFake = {
    platformClient: jest.fn(() => ({
      accounts: {
        retrieve: jest.fn(async (id: string) => ({ id, details_submitted: true, charges_enabled: true, capabilities: { card_payments: 'active' } })),
        create: jest.fn(async (params: Record<string, unknown>) => {
          accountsCreate.push(params);
          return { id: `acct_fake_${randomUUID()}` };
        }),
        update: jest.fn(),
        del: jest.fn(),
      },
      accountLinks: {
        create: jest.fn(async (params: unknown) => {
          accountLinks.push(params);
          return { url: 'https://connect.stripe.test/onboarding' };
        }),
      },
    })),
    scopedClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };
  let app: INestApplication;
  const env = { ret: process.env.STRIPE_CONNECT_RETURN_URL, refresh: process.env.STRIPE_CONNECT_REFRESH_URL };

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.STRIPE_CONNECT_RETURN_URL = 'https://portal.example.test/payments/connect/return';
    process.env.STRIPE_CONNECT_REFRESH_URL = 'https://portal.example.test/payments/connect/refresh';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(stripeFake).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    process.env.STRIPE_CONNECT_RETURN_URL = env.ret;
    process.env.STRIPE_CONNECT_REFRESH_URL = env.refresh;
    await superuser.paymentAccount.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { franchiseId: { in: franchiseIds } }] } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function owner(role: 'SCHOOL_OWNER_MANAGER' | 'FRANCHISE_OWNER', scope: { schoolId?: string; franchiseId?: string }) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `connect-countries-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Owner',
        surname: 'Connect',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, ...scope } });
    return jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: scope.franchiseId ?? null, schoolId: scope.schoolId ?? null, branchId: null }] });
  }

  async function school(addressCountry: string | null) {
    const row = await superuser.school.create({ data: { id: randomUUID(), name: `Connect School ${addressCountry ?? 'none'}`, addressCountry } });
    schoolIds.push(row.id);
    return { school: row, token: await owner('SCHOOL_OWNER_MANAGER', { schoolId: row.id }) };
  }

  async function franchise(addressCountry: string | null) {
    const row = await superuser.franchise.create({ data: { id: randomUUID(), name: `Connect Franchise ${addressCountry ?? 'none'}`, addressCountry } });
    franchiseIds.push(row.id);
    return { franchise: row, token: await owner('FRANCHISE_OWNER', { franchiseId: row.id }) };
  }

  const http = () => request(app.getHttpServer());
  const get = (path: string, token: string) => http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, body: object = {}) => http().post(path).set('Authorization', `Bearer ${token}`).send(body);

  describe('School', () => {
    it('a Brazilian School is refused with the reason, translated, and nothing reaches Stripe', async () => {
      const { school: s, token } = await school('BR');
      const created = await post(`/v1/schools/${s.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Academia', country: 'BR' });
      expect(created.status).toBe(201);
      expect(created.body.connectAvailable).toBe(false);
      expect((await get(`/v1/schools/${s.id}/payment-account`, token)).body.connectAvailable).toBe(false);

      const before = { accounts: accountsCreate.length, links: accountLinks.length };
      const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, token);
      expect(onboard.status).toBe(400);
      expect(onboard.body.error.message).toBe(REFUSED);
      expect({ accounts: accountsCreate.length, links: accountLinks.length }).toEqual(before);
      expect((await superuser.paymentAccount.findUnique({ where: { id: created.body.id } }))?.stripeConnectedAccountId).toBeNull();

      // The reason the portal and the student app show, in every language.
      for (const locale of Object.keys(SERVER_MESSAGE_LOADERS)) {
        const messages = await SERVER_MESSAGE_LOADERS[locale]();
        expect(messages[REFUSED]).toEqual(expect.any(String));
        expect(messages[REFUSED]).not.toBe(REFUSED);
      }
    });

    it('a country that is not an ISO 3166-1 alpha-2 code is refused', async () => {
      const { school: s, token } = await school(null);
      const created = await post(`/v1/schools/${s.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Typo', country: 'United Kingdom' });
      expect(created.body.connectAvailable).toBe(false);
      const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, token);
      expect(onboard.status).toBe(400);
      expect(onboard.body.error.message).toBe("This payment account's country isn't a valid two-letter country code (ISO 3166-1 alpha-2).");
    });

    it.each(['GB', 'IE', 'de'])('a %s School starts onboarding, the country passed to Stripe in capitals', async (country) => {
      const { school: s, token } = await school(country.toUpperCase());
      const created = await post(`/v1/schools/${s.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'School', country });
      expect(created.body.connectAvailable).toBe(true);
      const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, token);
      expect(onboard.status).toBe(201);
      expect(onboard.body.onboardingUrl).toBe('https://connect.stripe.test/onboarding');
      expect(accountsCreate[accountsCreate.length - 1]).toEqual(expect.objectContaining({ type: 'express', country: country.toUpperCase() }));
    });

    it('an account already connected in another country keeps working', async () => {
      const { school: s, token } = await school('BR');
      const account = await superuser.paymentAccount.create({
        data: { id: randomUUID(), schoolId: s.id, provider: 'STRIPE', accountTitle: 'Legacy', country: 'BR', stripeAccountReady: true, stripeConnectedAccountId: `acct_legacy_${randomUUID()}` },
      });
      expect((await get(`/v1/schools/${s.id}/payment-account`, token)).body.connectAvailable).toBe(true);
      const before = accountsCreate.length;
      const onboard = await post(`/v1/payment-accounts/${account.id}/connect/onboard`, token);
      expect(onboard.status).toBe(201);
      expect(accountsCreate.length).toBe(before);
    });

    it("the Dashboard leaves the Stripe step out for a Brazilian School and keeps it for a UK one", async () => {
      const br = await school('BR');
      const brDash = await get(`/v1/schools/${br.school.id}/dashboard`, br.token);
      expect(brDash.status).toBe(200);
      expect(brDash.body.setupChecklist.stripeConnectAvailable).toBe(false);
      expect(brDash.body.setupChecklist.steps.map((st: { key: string }) => st.key)).not.toContain('STRIPE');

      const gb = await school('GB');
      const gbDash = await get(`/v1/schools/${gb.school.id}/dashboard`, gb.token);
      expect(gbDash.body.setupChecklist.stripeConnectAvailable).toBe(true);
      expect(gbDash.body.setupChecklist.steps.map((st: { key: string }) => st.key)).toContain('STRIPE');

      // A School with no address country yet keeps the step.
      const none = await school(null);
      expect((await get(`/v1/schools/${none.school.id}/dashboard`, none.token)).body.setupChecklist.stripeConnectAvailable).toBe(true);
    });

    it("another School's owner can't read or start it (tenant isolation unchanged)", async () => {
      const { school: s, token } = await school('GB');
      const created = await post(`/v1/schools/${s.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Mine', country: 'GB' });
      const other = await school('GB');
      expect((await get(`/v1/schools/${s.id}/payment-account`, other.token)).status).toBe(404);
      expect((await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, other.token)).status).toBe(404);
    });
  });

  describe("the School's public profile, for the member app", () => {
    it('says whether the School takes card payments and whether it is in Brazil, to any signed-in member', async () => {
      const br = await school('BR');
      await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: br.school.id, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' } });
      const gb = await school('GB');
      await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: gb.school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeAccountReady: true, stripeConnectedAccountId: `acct_pub_${randomUUID()}` } });
      const none = await school(null);
      // A member of another School reads them: the profile is public to the signed-in.
      const reader = (await school('IE')).token;

      const brBody = (await get(`/v1/academies/${br.school.id}`, reader)).body;
      expect({ cardPayments: brBody.cardPayments, inBrazil: brBody.inBrazil }).toEqual({ cardPayments: false, inBrazil: true });
      const gbBody = (await get(`/v1/academies/${gb.school.id}`, reader)).body;
      expect({ cardPayments: gbBody.cardPayments, inBrazil: gbBody.inBrazil }).toEqual({ cardPayments: true, inBrazil: false });
      const noneBody = (await get(`/v1/academies/${none.school.id}`, reader)).body;
      expect({ cardPayments: noneBody.cardPayments, inBrazil: noneBody.inBrazil }).toEqual({ cardPayments: false, inBrazil: false });
      // Nothing else about the payment account or the address leaves.
      expect(brBody).not.toHaveProperty('addressCountry');
      expect(JSON.stringify(gbBody)).not.toContain('acct_pub_');
    });
  });

  describe('Franchise', () => {
    it('connect-status says Connect is not available for a Brazilian Franchise, and onboarding is refused', async () => {
      const { franchise: f, token } = await franchise('BR');
      const status = await get(`/v1/franchises/${f.id}/payment-account/connect-status`, token);
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ status: 'NOT_CONNECTED', connectAvailable: false, connectCountries: expect.any(Array) });
      expect(status.body.connectCountries).toHaveLength(32);
      expect(status.body.connectCountries).not.toContain('BR');
      expect(status.body.connectCountries).toEqual(expect.arrayContaining(['GB', 'FR', 'NO', 'CH', 'LI', 'GI']));

      const created = await post(`/v1/franchises/${f.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Rede', country: 'BR' });
      expect(created.body.connectAvailable).toBe(false);
      const before = accountsCreate.length;
      const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, token);
      expect(onboard.status).toBe(400);
      expect(onboard.body.error.message).toBe(REFUSED);
      expect(accountsCreate.length).toBe(before);
      expect((await get(`/v1/franchises/${f.id}/payment-account`, token)).body.connectAvailable).toBe(false);
    });

    it("a UK Franchise is available and starts; the Stripe account's own country decides over the address", async () => {
      const { franchise: f, token } = await franchise('GB');
      expect((await get(`/v1/franchises/${f.id}/payment-account/connect-status`, token)).body.connectAvailable).toBe(true);
      const created = await post(`/v1/franchises/${f.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Network', country: 'FR' });
      expect(created.body.connectAvailable).toBe(true);
      const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, token);
      expect(onboard.status).toBe(201);
      expect(accountsCreate[accountsCreate.length - 1]).toEqual(expect.objectContaining({ country: 'FR' }));
      expect((await get(`/v1/franchises/${f.id}/payment-account/connect-status`, token)).body).toEqual(
        expect.objectContaining({ status: 'CONNECTED', connectAvailable: true }),
      );
    });

    it("another Franchise's owner gets 404, as before", async () => {
      const { franchise: f } = await franchise('BR');
      const other = await franchise('GB');
      expect((await get(`/v1/franchises/${f.id}/payment-account/connect-status`, other.token)).status).toBe(404);
    });
  });
});
