import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { addressWriteData } from './postal-address.dto';
import { formatPostalAddress, normalizePostalAddress, validatePostalAddress } from './postal-address';

describe('postal-address (Decision 276)', () => {
  it('is byte-identical to packages/ui/src/postalAddress.ts, the copy the School Portal validates with', () => {
    const api = readFileSync(join(__dirname, 'postal-address.ts'), 'utf8');
    const ui = readFileSync(join(__dirname, '../../../../../packages/ui/src/postalAddress.ts'), 'utf8');
    expect(api).toBe(ui);
  });

  describe('validatePostalAddress', () => {
    it('treats an all-blank address as "no address", whatever the country', () => {
      expect(validatePostalAddress({ country: 'US' })).toEqual({});
      expect(validatePostalAddress(null)).toEqual({});
    });

    it('needs a country once anything is filled in', () => {
      expect(validatePostalAddress({ line1: '1 Main St' })).toEqual({ country: 'required' });
    });

    it("applies each country's own required fields", () => {
      expect(validatePostalAddress({ line1: '1 Main St', country: 'US' })).toEqual({
        city: 'required',
        region: 'required',
        postalCode: 'required',
      });
      // UAE has no postcodes; the emirate is what's required.
      expect(validatePostalAddress({ line1: 'Villa 3', country: 'AE' })).toEqual({ region: 'required' });
      // Unlisted countries fall back to street + city only.
      expect(validatePostalAddress({ line1: 'Rruga 1', city: 'Tirana', country: 'AL' })).toEqual({});
    });

    it('checks postal codes against the country format', () => {
      const gb = { line1: '10 Downing St', city: 'London', country: 'GB' };
      expect(validatePostalAddress({ ...gb, postalCode: 'sw1a 2aa' })).toEqual({});
      expect(validatePostalAddress({ ...gb, postalCode: '12345' })).toEqual({ postalCode: 'invalid' });
      const br = { line1: 'Av. Paulista, 1000', city: 'São Paulo', region: 'SP', country: 'BR' };
      expect(validatePostalAddress({ ...br, postalCode: '01310-100' })).toEqual({});
      expect(validatePostalAddress({ ...br, postalCode: '0131' })).toEqual({ postalCode: 'invalid' });
    });

    it('accepts a fixed-list region by name and stores its code', () => {
      const address = { line1: '1 Infinite Loop', city: 'Cupertino', region: 'california', postalCode: '95014', country: 'us' };
      expect(validatePostalAddress(address)).toEqual({});
      expect(normalizePostalAddress(address)).toMatchObject({ region: 'CA', country: 'US' });
      expect(validatePostalAddress({ ...address, region: 'Narnia' })).toEqual({ region: 'invalid' });
    });
  });

  describe('formatPostalAddress', () => {
    it("lays out the locality in the country's own order", () => {
      expect(
        formatPostalAddress({ line1: '1 Infinite Loop', city: 'Cupertino', region: 'CA', postalCode: '95014', country: 'US' }, 'United States'),
      ).toBe('1 Infinite Loop, Cupertino, CA 95014, United States');
      expect(formatPostalAddress({ line1: 'Unter den Linden 1', city: 'Berlin', postalCode: '10117', country: 'DE' }, 'Germany')).toBe(
        'Unter den Linden 1, 10117 Berlin, Germany',
      );
      expect(formatPostalAddress({ line1: 'Villa 3, Street 12', city: 'Al Barsha', region: 'Dubai', country: 'AE' }, 'United Arab Emirates')).toBe(
        'Villa 3, Street 12, Al Barsha, Dubai, United Arab Emirates',
      );
    });

    it('drops separators next to a missing value', () => {
      expect(formatPostalAddress({ line1: '1 Main St', city: 'Springfield', postalCode: '12345', country: 'US' }, 'United States')).toBe(
        '1 Main St, Springfield, 12345, United States',
      );
    });

    it('drops fields the country does not use', () => {
      expect(formatPostalAddress({ line1: '1 Raffles Pl', city: 'ignored', region: 'ignored', postalCode: '048616', country: 'SG' }, 'Singapore')).toBe(
        '1 Raffles Pl, 048616, Singapore',
      );
    });
  });

  describe('addressWriteData', () => {
    it('leaves the stored address alone when neither field is sent', () => {
      expect(addressWriteData({})).toEqual({});
    });

    it('stores the structured columns and rebuilds the one-line text', () => {
      expect(
        addressWriteData({
          postalAddress: { line1: ' 10 Downing St ', city: 'London', postalCode: 'sw1a 2aa', country: 'gb' },
        }),
      ).toEqual({
        address: '10 Downing St, London, SW1A 2AA, United Kingdom',
        addressLine1: '10 Downing St',
        addressLine2: null,
        addressCity: 'London',
        addressRegion: null,
        addressPostalCode: 'SW1A 2AA',
        addressCountry: 'GB',
      });
    });

    it('clears everything for null or an all-blank address', () => {
      const cleared = {
        address: null,
        addressLine1: null,
        addressLine2: null,
        addressCity: null,
        addressRegion: null,
        addressPostalCode: null,
        addressCountry: null,
      };
      expect(addressWriteData({ postalAddress: null })).toEqual(cleared);
      expect(addressWriteData({ postalAddress: { line1: '  ', country: 'GB' } })).toEqual(cleared);
    });

    it('keeps accepting the legacy free-text address and clears the structured columns', () => {
      expect(addressWriteData({ address: '1 Old Road' })).toMatchObject({ address: '1 Old Road', addressCountry: null, addressLine1: null });
    });

    it('rejects an address that breaks its country rules, naming the field', () => {
      expect(() => addressWriteData({ postalAddress: { line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: 'ABC', country: 'US' } })).toThrow(
        BadRequestException,
      );
      try {
        addressWriteData({ postalAddress: { line1: '1 Main St', city: 'Nowhere', country: 'XX' } });
      } catch (e) {
        expect((e as BadRequestException).getResponse()).toMatchObject({
          message: ['postalAddress.country must be an ISO 3166-1 alpha-2 country code.'],
        });
      }
    });
  });
});
