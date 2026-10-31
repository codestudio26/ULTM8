import { BadGatewayException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AddressLookupService, languageFromHeader } from './address-lookup.service';
import type { PlacesHttpRequest, PlacesHttpResponse } from './places-http';

const KEY = 'test-places-key-never-logged';

describe('AddressLookupService', () => {
  const original = process.env.GOOGLE_PLACES_API_KEY;
  let calls: PlacesHttpRequest[];
  let reply: (req: PlacesHttpRequest) => Promise<PlacesHttpResponse>;
  let service: AddressLookupService;

  beforeEach(() => {
    calls = [];
    reply = async () => ({ status: 200, body: '{}' });
    service = new AddressLookupService((req) => {
      calls.push(req);
      return reply(req);
    });
  });
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = original;
    jest.restoreAllMocks();
  });

  describe('without a key', () => {
    beforeEach(() => delete process.env.GOOGLE_PLACES_API_KEY);

    it('reports itself switched off and refuses lookups with 503 without calling Google', async () => {
      expect(service.status()).toEqual({ enabled: false });
      await expect(service.autocomplete({ q: 'Baker St' })).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.details({ placeId: 'abc' })).rejects.toMatchObject({ response: { code: 'ADDRESS_LOOKUP_NOT_CONFIGURED' } });
      expect(calls).toHaveLength(0);
    });

    it('treats a blank key as no key', () => {
      process.env.GOOGLE_PLACES_API_KEY = '   ';
      expect(service.status()).toEqual({ enabled: false });
    });
  });

  describe('with a key', () => {
    beforeEach(() => (process.env.GOOGLE_PLACES_API_KEY = KEY));

    it('sends autocomplete with the key in a header only, the country, language and session', async () => {
      reply = async () => ({
        status: 200,
        body: JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: 'p1',
                text: { text: '10 Downing Street, London, UK' },
                structuredFormat: { mainText: { text: '10 Downing Street' }, secondaryText: { text: 'London, UK' } },
              },
            },
            { queryPrediction: { text: { text: 'downing street pubs' } } },
          ],
        }),
      });
      const res = await service.autocomplete({ q: '10 Downing', country: 'GB', language: 'en-GB', sessionToken: 'sess-1' });
      expect(res).toEqual({ suggestions: [{ placeId: 'p1', text: '10 Downing Street, London, UK', mainText: '10 Downing Street', secondaryText: 'London, UK' }] });
      const [req] = calls;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://places.googleapis.com/v1/places:autocomplete');
      expect(req.url).not.toContain(KEY);
      expect(req.headers['X-Goog-Api-Key']).toBe(KEY);
      expect(JSON.parse(req.body!)).toEqual({ input: '10 Downing', includedRegionCodes: ['gb'], languageCode: 'en-GB', sessionToken: 'sess-1' });
      expect(req.timeoutMs).toBeLessThanOrEqual(5_000);
    });

    it('falls back to the Accept-Language header for the language', async () => {
      await service.autocomplete({ q: 'Avenida Paulista' }, 'pt-BR,pt;q=0.9,en;q=0.8');
      expect(JSON.parse(calls[0].body!).languageCode).toBe('pt-BR');
    });

    it('asks details for the address fields only and maps them', async () => {
      reply = async () => ({
        status: 200,
        body: JSON.stringify({
          id: 'p1',
          addressComponents: [
            { longText: '10', shortText: '10', types: ['street_number'] },
            { longText: 'Downing Street', shortText: 'Downing St', types: ['route'] },
            { longText: 'London', shortText: 'London', types: ['postal_town'] },
            { longText: 'United Kingdom', shortText: 'GB', types: ['country', 'political'] },
            { longText: 'SW1A 2AA', shortText: 'SW1A 2AA', types: ['postal_code'] },
          ],
        }),
      });
      const res = await service.details({ placeId: 'p1', sessionToken: 'sess-1', language: 'en-GB' });
      expect(res).toEqual({
        placeId: 'p1',
        postalAddress: { line1: '10 Downing Street', line2: '', city: 'London', region: '', postalCode: 'SW1A 2AA', country: 'GB' },
        formattedAddress: '10 Downing Street, London, SW1A 2AA, United Kingdom',
        complete: true,
      });
      const [req] = calls;
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://places.googleapis.com/v1/places/p1?languageCode=en-GB&sessionToken=sess-1');
      expect(req.headers['X-Goog-FieldMask']).toBe('id,formattedAddress,adrFormatAddress,addressComponents');
      expect(req.headers['X-Goog-Api-Key']).toBe(KEY);
    });

    it('says when a looked-up address is missing something the country needs', async () => {
      reply = async () => ({ status: 200, body: JSON.stringify({ id: 'p2', addressComponents: [{ longText: 'United States', shortText: 'US', types: ['country'] }] }) });
      expect((await service.details({ placeId: 'p2' })).complete).toBe(false);
    });

    it('answers 404 for a place Google does not know, 502 for other failures, and never logs the key', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      reply = async () => ({ status: 404, body: '{"error":{"message":"Not found"}}' });
      await expect(service.details({ placeId: 'nope' })).rejects.toBeInstanceOf(NotFoundException);

      reply = async () => ({ status: 403, body: `{"error":{"message":"API key ${KEY} not valid"}}` });
      await expect(service.autocomplete({ q: 'x' })).rejects.toBeInstanceOf(BadGatewayException);

      reply = async () => ({ status: 200, body: 'not json' });
      await expect(service.autocomplete({ q: 'x' })).rejects.toBeInstanceOf(BadGatewayException);

      reply = async () => {
        throw new Error('Address lookup timed out');
      };
      await expect(service.details({ placeId: 'p1' })).rejects.toMatchObject({ response: { code: 'ADDRESS_LOOKUP_FAILED' } });

      const logged = warn.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(logged).toContain('HTTP 403');
      expect(logged).not.toContain(KEY);
    });
  });
});

describe('languageFromHeader', () => {
  it('takes the first tag, or nothing', () => {
    expect(languageFromHeader('ja,en;q=0.5')).toBe('ja');
    expect(languageFromHeader('*')).toBeUndefined();
    expect(languageFromHeader(undefined)).toBeUndefined();
  });
});
