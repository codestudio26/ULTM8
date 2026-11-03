import { mapGooglePlaceToPostalAddress, streetFromAdrFormat, type GoogleAddressComponent } from './google-address-mapping';
import { validatePostalAddress } from '../common/address/postal-address';

/** Shorthand for one Google address component. */
const c = (longText: string, types: string[], shortText = longText, languageCode = 'en'): GoogleAddressComponent => ({
  longText,
  shortText,
  types: [...types, 'political'].filter((t, i, all) => all.indexOf(t) === i),
  languageCode,
});

describe('mapGooglePlaceToPostalAddress', () => {
  it('UK: number before street, post town as the city, Greater London as the county', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('10', ['street_number']),
        c('Downing Street', ['route'], 'Downing St'),
        c('London', ['postal_town']),
        c('Greater London', ['administrative_area_level_2']),
        c('England', ['administrative_area_level_1']),
        c('United Kingdom', ['country'], 'GB'),
        c('SW1A 2AA', ['postal_code']),
      ],
    });
    expect(address).toEqual({ line1: '10 Downing Street', line2: '', city: 'London', region: 'Greater London', postalCode: 'SW1A 2AA', country: 'GB' });
    expect(validatePostalAddress(address)).toEqual({});
  });

  it('UK: a flat goes on line 2', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('Flat 3', ['subpremise']),
        c('221B', ['street_number']),
        c('Baker Street', ['route']),
        c('London', ['postal_town']),
        c('United Kingdom', ['country'], 'GB'),
        c('NW1 6XE', ['postal_code']),
      ],
    });
    expect(address).toMatchObject({ line1: '221B Baker Street', line2: 'Flat 3', city: 'London', postalCode: 'NW1 6XE' });
  });

  it('US: the state is the short code the State list stores', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('1600', ['street_number']),
        c('Amphitheatre Parkway', ['route'], 'Amphitheatre Pkwy'),
        c('Mountain View', ['locality']),
        c('Santa Clara County', ['administrative_area_level_2']),
        c('California', ['administrative_area_level_1'], 'CA'),
        c('United States', ['country'], 'US'),
        c('94043', ['postal_code']),
        c('1351', ['postal_code_suffix']),
      ],
    });
    expect(address).toEqual({ line1: '1600 Amphitheatre Parkway', line2: '', city: 'Mountain View', region: 'CA', postalCode: '94043', country: 'US' });
    expect(validatePostalAddress(address)).toEqual({});
  });

  it('Brazil: "street, number", the bairro on line 2, the state code', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('1578', ['street_number'], '1578', 'pt'),
        c('Avenida Paulista', ['route'], 'Av. Paulista', 'pt'),
        c('Bela Vista', ['sublocality_level_1', 'sublocality'], 'Bela Vista', 'pt'),
        c('São Paulo', ['administrative_area_level_2'], 'São Paulo', 'pt'),
        c('São Paulo', ['locality'], 'São Paulo', 'pt'),
        c('São Paulo', ['administrative_area_level_1'], 'SP', 'pt'),
        c('Brasil', ['country'], 'BR', 'pt'),
        c('01310-200', ['postal_code'], '01310-200', 'pt'),
      ],
    });
    expect(address).toEqual({ line1: 'Avenida Paulista, 1578', line2: 'Bela Vista', city: 'São Paulo', region: 'SP', postalCode: '01310-200', country: 'BR' });
    expect(validatePostalAddress(address)).toEqual({});
  });

  it("Japan: Google's own street line, the prefecture and the ward as the city", () => {
    const address = mapGooglePlaceToPostalAddress({
      adrFormatAddress:
        '〒<span class="postal-code">100-0005</span> <span class="region">東京都</span><span class="locality">千代田区</span><span class="street-address">丸の内１丁目９−１</span>',
      addressComponents: [
        c('1', ['premise'], '1', 'ja'),
        c('9', ['sublocality_level_4', 'sublocality'], '9', 'ja'),
        c('1丁目', ['sublocality_level_2', 'sublocality'], '1丁目', 'ja'),
        c('丸の内', ['sublocality_level_1', 'sublocality'], '丸の内', 'ja'),
        c('千代田区', ['locality'], '千代田区', 'ja'),
        c('東京都', ['administrative_area_level_1'], '東京都', 'ja'),
        c('日本', ['country'], 'JP', 'ja'),
        c('100-0005', ['postal_code'], '100-0005', 'ja'),
      ],
    });
    expect(address).toEqual({ line1: '丸の内１丁目９−１', line2: '', city: '千代田区', region: '東京都', postalCode: '100-0005', country: 'JP' });
    expect(validatePostalAddress(address)).toEqual({});
  });

  it('Japan without the markup: the blocks and building from the components', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('1', ['premise'], '1', 'ja'),
        c('丸の内', ['sublocality_level_1', 'sublocality'], '丸の内', 'ja'),
        c('1丁目', ['sublocality_level_2', 'sublocality'], '1丁目', 'ja'),
        c('9', ['sublocality_level_3', 'sublocality'], '9', 'ja'),
        c('千代田区', ['locality'], '千代田区', 'ja'),
        c('東京都', ['administrative_area_level_1'], '東京都', 'ja'),
        c('日本', ['country'], 'JP', 'ja'),
        c('100-0005', ['postal_code'], '100-0005', 'ja'),
      ],
    });
    expect(address.line1).toBe('丸の内1丁目9-1');
  });

  it('UAE: the neighbourhood as the area, the emirate from the fixed list, no postal code', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('Sheikh Mohammed bin Rashid Boulevard', ['route']),
        c('Downtown Dubai', ['sublocality_level_1', 'sublocality']),
        c('Dubai', ['locality']),
        c('Dubai', ['administrative_area_level_1']),
        c('United Arab Emirates', ['country'], 'AE'),
      ],
    });
    expect(address).toEqual({ line1: 'Sheikh Mohammed bin Rashid Boulevard', line2: '', city: 'Downtown Dubai', region: 'Dubai', postalCode: '', country: 'AE' });
    expect(validatePostalAddress(address)).toEqual({});
  });

  it('Germany: number after the street, no comma', () => {
    const address = mapGooglePlaceToPostalAddress({
      addressComponents: [
        c('1', ['street_number'], '1', 'de'),
        c('Unter den Linden', ['route'], 'Unter den Linden', 'de'),
        c('Berlin', ['locality'], 'Berlin', 'de'),
        c('Berlin', ['administrative_area_level_1'], 'BE', 'de'),
        c('Deutschland', ['country'], 'DE', 'de'),
        c('10117', ['postal_code'], '10117', 'de'),
      ],
    });
    // Germany has no region field, so the Land is dropped.
    expect(address).toEqual({ line1: 'Unter den Linden 1', line2: '', city: 'Berlin', region: '', postalCode: '10117', country: 'DE' });
  });

  it("leaves what Google doesn't give blank, and falls back to Google's street line", () => {
    const address = mapGooglePlaceToPostalAddress({
      adrFormatAddress: '<span class="street-address">Rural Route 5 &amp; Mill Lane</span>, <span class="country-name">USA</span>',
      addressComponents: [c('United States', ['country'], 'US')],
    });
    expect(address).toEqual({ line1: 'Rural Route 5 & Mill Lane', line2: '', city: '', region: '', postalCode: '', country: 'US' });
    expect(validatePostalAddress(address)).toMatchObject({ city: 'required', region: 'required', postalCode: 'required' });
  });

  it('copes with no components at all', () => {
    expect(mapGooglePlaceToPostalAddress({})).toEqual({ line1: '', line2: '', city: '', region: '', postalCode: '', country: '' });
  });
});

describe('streetFromAdrFormat', () => {
  it('reads the street-address span and decodes entities', () => {
    expect(streetFromAdrFormat('<span class="street-address">5 O&#39;Connell St</span>, Dublin')).toBe("5 O'Connell St");
    expect(streetFromAdrFormat('no markup')).toBe('');
    expect(streetFromAdrFormat(undefined)).toBe('');
  });
});
