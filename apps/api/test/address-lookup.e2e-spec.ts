/**
 * Google Places street lookup (Decision 212, built in v1.3 per Decision 267),
 * over real HTTP with the app's real guards, throttler and validation. Google
 * itself is never called: the network layer (PLACES_HTTP) is replaced with a
 * fake that answers like Places API (New).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PLACES_HTTP, type PlacesHttpRequest, type PlacesHttpResponse } from '../src/address-lookup/places-http';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[address-lookup.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const FAKE_KEY = 'fake-places-key-for-e2e';

describeIfDb('Address lookup (Google Places)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const calls: PlacesHttpRequest[] = [];
  let reply: (req: PlacesHttpRequest) => PlacesHttpResponse;
  let userId: string;
  let token: string;

  const get = (path: string, auth = true) => {
    const r = request(app.getHttpServer()).get(`/v1/address-lookup/${path}`);
    return auth ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLACES_HTTP)
      .useValue(async (req: PlacesHttpRequest) => {
        calls.push(req);
        return reply(req);
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `address-lookup-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Lookup',
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userId = u.id;
    token = jwt.sign({ sub: u.id, email: u.email, grants: [] });
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalKey;
    await superuser.user.deleteMany({ where: { id: userId } });
    await superuser.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
    reply = () => ({ status: 500, body: '{}' });
  });

  it('needs a signed-in user for every route', async () => {
    process.env.GOOGLE_PLACES_API_KEY = FAKE_KEY;
    for (const path of ['status', 'autocomplete?q=Baker', 'details?placeId=abc']) {
      expect((await get(path, false)).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  describe('switched off (no GOOGLE_PLACES_API_KEY)', () => {
    beforeEach(() => delete process.env.GOOGLE_PLACES_API_KEY);

    it('status says enabled: false', async () => {
      const res = await get('status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false });
    });

    it('lookups answer 503 ADDRESS_LOOKUP_NOT_CONFIGURED without calling Google', async () => {
      const auto = await get('autocomplete?q=10%20Downing');
      expect(auto.status).toBe(503);
      expect(auto.body.error.code).toBe('ADDRESS_LOOKUP_NOT_CONFIGURED');
      const details = await get('details?placeId=abc');
      expect(details.status).toBe(503);
      expect(details.body.error.code).toBe('ADDRESS_LOOKUP_NOT_CONFIGURED');
      expect(calls).toHaveLength(0);
    });
  });

  describe('switched on', () => {
    beforeEach(() => (process.env.GOOGLE_PLACES_API_KEY = FAKE_KEY));

    it('status says enabled: true', async () => {
      expect((await get('status')).body).toEqual({ enabled: true });
    });

    it('returns suggestions, in the requested language and country, keeping the key server-side', async () => {
      reply = () => ({
        status: 200,
        body: JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: 'ChIJ-downing',
                text: { text: '10 Downing Street, London, UK' },
                structuredFormat: { mainText: { text: '10 Downing Street' }, secondaryText: { text: 'London, UK' } },
              },
            },
          ],
        }),
      });
      const res = await get('autocomplete?q=10%20Downing&country=gb&language=en-GB&sessionToken=0b5c2f9e-1d2a-4c55-9a51-7c3f1f2b1a10');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        suggestions: [{ placeId: 'ChIJ-downing', text: '10 Downing Street, London, UK', mainText: '10 Downing Street', secondaryText: 'London, UK' }],
      });
      expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
      expect(calls).toHaveLength(1);
      expect(calls[0].headers['X-Goog-Api-Key']).toBe(FAKE_KEY);
      expect(JSON.parse(calls[0].body!)).toEqual({
        input: '10 Downing',
        includedRegionCodes: ['gb'],
        languageCode: 'en-GB',
        sessionToken: '0b5c2f9e-1d2a-4c55-9a51-7c3f1f2b1a10',
      });
    });

    it('returns the chosen place as a structured address', async () => {
      reply = () => ({
        status: 200,
        body: JSON.stringify({
          id: 'ChIJ-paulista',
          formattedAddress: 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200, Brasil',
          addressComponents: [
            { longText: '1578', shortText: '1578', types: ['street_number'], languageCode: 'pt' },
            { longText: 'Avenida Paulista', shortText: 'Av. Paulista', types: ['route'], languageCode: 'pt' },
            { longText: 'Bela Vista', shortText: 'Bela Vista', types: ['sublocality_level_1', 'sublocality', 'political'], languageCode: 'pt' },
            { longText: 'São Paulo', shortText: 'São Paulo', types: ['locality', 'political'], languageCode: 'pt' },
            { longText: 'São Paulo', shortText: 'SP', types: ['administrative_area_level_1', 'political'], languageCode: 'pt' },
            { longText: 'Brasil', shortText: 'BR', types: ['country', 'political'], languageCode: 'pt' },
            { longText: '01310-200', shortText: '01310-200', types: ['postal_code'], languageCode: 'pt' },
          ],
        }),
      });
      const res = await get('details?placeId=ChIJ-paulista').set('Accept-Language', 'pt-BR,pt;q=0.9');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        placeId: 'ChIJ-paulista',
        postalAddress: { line1: 'Avenida Paulista, 1578', line2: 'Bela Vista', city: 'São Paulo', region: 'SP', postalCode: '01310-200', country: 'BR' },
        formattedAddress: expect.stringContaining('Avenida Paulista, 1578'),
        complete: true,
      });
      expect(calls[0].url).toBe('https://places.googleapis.com/v1/places/ChIJ-paulista?languageCode=pt-BR');
      expect(calls[0].url).not.toContain(FAKE_KEY);
    });

    it('a Google failure is a 502, an unknown place a 404', async () => {
      reply = () => ({ status: 500, body: 'oops' });
      const failed = await get('autocomplete?q=anything');
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('ADDRESS_LOOKUP_FAILED');

      reply = () => ({ status: 404, body: '{}' });
      const missing = await get('details?placeId=gone');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('ADDRESS_LOOKUP_PLACE_NOT_FOUND');
    });

    it('rejects bad input before calling Google', async () => {
      expect((await get('autocomplete')).status).toBe(400);
      expect((await get(`autocomplete?q=${'x'.repeat(201)}`)).status).toBe(400);
      expect((await get('autocomplete?q=Baker&country=XX')).status).toBe(400);
      expect((await get('autocomplete?q=Baker&sessionToken=bad%20token')).status).toBe(400);
      expect((await get('details?placeId=..%2F..%2Fsecret')).status).toBe(400);
      expect(calls).toHaveLength(0);
    });
  });
});
