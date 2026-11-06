import { localizeAddressCountry } from '@ultm8/i18n';
import { addressWriteData, countryName } from './postal-address.dto';

/**
 * Decision 441 item 7: the apps show a stored address with its country in the
 * reader's language. The address is stored as the API writes it (English
 * country name); `localizeAddressCountry` (@ultm8/i18n) swaps only that part.
 */
describe('localizeAddressCountry', () => {
  const stored = addressWriteData({
    postalAddress: { line1: 'Rua Augusta, 1500', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' },
  }).address!;

  it('the stored text keeps the English name', () => {
    expect(stored).toBe('Rua Augusta, 1500, São Paulo-SP, 01304-001, Brazil');
  });

  it("shows the country in the reader's language, from the code or from the English name", () => {
    expect(localizeAddressCountry(stored, 'pt-BR', 'BR')).toBe('Rua Augusta, 1500, São Paulo-SP, 01304-001, Brasil');
    expect(localizeAddressCountry(stored, 'pt-BR')).toBe('Rua Augusta, 1500, São Paulo-SP, 01304-001, Brasil');
    expect(localizeAddressCountry(stored, 'de')).toBe('Rua Augusta, 1500, São Paulo-SP, 01304-001, Brasilien');
    expect(localizeAddressCountry(stored, 'ja')).toMatch(/, ブラジル$/);
  });

  it('English readers, free text and empty values are left as they are', () => {
    expect(localizeAddressCountry(stored, 'en-GB', 'BR')).toBe(stored);
    expect(localizeAddressCountry(stored, undefined, 'BR')).toBe(stored);
    expect(localizeAddressCountry('12 High Street, Leeds', 'fr')).toBe('12 High Street, Leeds');
    expect(localizeAddressCountry('Brazil', 'fr')).toBe('Brazil');
    expect(localizeAddressCountry(null, 'fr')).toBeNull();
    expect(localizeAddressCountry('', 'fr')).toBe('');
  });

  it('a code that disagrees with the text falls back to the text', () => {
    expect(localizeAddressCountry(stored, 'es', 'PT')).toBe('Rua Augusta, 1500, São Paulo-SP, 01304-001, Brasil');
  });

  it('every country the API can store is recognised from its English name', () => {
    const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(65 + i, 65 + j);
        if (!regions.of(code)) continue;
        const text = `1 Main St, ${countryName(code)}`;
        // A region with no French name (e.g. Sark) keeps the English one.
        const local = new Intl.DisplayNames(['fr'], { type: 'region', fallback: 'none' }).of(code);
        expect(localizeAddressCountry(text, 'fr', code)).toBe(local ? `1 Main St, ${local}` : text);
        expect(localizeAddressCountry(text, 'fr')).toBe(local ? `1 Main St, ${local}` : text);
      }
    }
  });
});
