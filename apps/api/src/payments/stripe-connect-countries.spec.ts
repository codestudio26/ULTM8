import {
  DEFAULT_STRIPE_CONNECT_COUNTRIES,
  isStripeConnectCountry,
  normalizeCountryCode,
  stripeConnectAvailable,
  stripeConnectCountries,
} from './stripe-connect-countries';

/** Decision 437 — where Stripe Connect onboarding is allowed for ULTM8's UK platform. */
describe('Stripe Connect countries (Decision 437)', () => {
  const EU27 = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

  it('defaults to the 32 ticked countries: GB, the EU27, NO, CH, LI and GI', () => {
    expect(EU27).toHaveLength(27);
    expect([...DEFAULT_STRIPE_CONNECT_COUNTRIES].sort()).toEqual(['GB', ...EU27, 'NO', 'CH', 'LI', 'GI'].sort());
    expect(stripeConnectCountries({})).toHaveLength(32);
  });

  it('leaves out Brazil, the rest of South America, and the countries Stripe offers that are not ticked', () => {
    for (const code of ['BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'US', 'CA', 'AU', 'MX', 'AE']) {
      expect(isStripeConnectCountry(code, {})).toBe(false);
    }
    for (const code of ['GB', 'IE', 'DE', 'PT', 'NO', 'CH', 'LI', 'GI']) {
      expect(isStripeConnectCountry(code, {})).toBe(true);
    }
  });

  it('reads a code in any case, but only a real ISO 3166-1 alpha-2 code', () => {
    expect(normalizeCountryCode(' gb ')).toBe('GB');
    expect(isStripeConnectCountry('gb', {})).toBe(true);
    for (const bad of ['XX', 'GBR', 'United Kingdom', '', null, undefined]) {
      expect(normalizeCountryCode(bad)).toBeNull();
      expect(isStripeConnectCountry(bad, {})).toBe(false);
    }
  });

  it('STRIPE_CONNECT_COUNTRIES replaces the default; a value that is not ISO codes throws', () => {
    expect(stripeConnectCountries({ STRIPE_CONNECT_COUNTRIES: 'fr, GB ,FR' })).toEqual(['FR', 'GB']);
    expect(isStripeConnectCountry('DE', { STRIPE_CONNECT_COUNTRIES: 'GB' })).toBe(false);
    expect(stripeConnectCountries({ STRIPE_CONNECT_COUNTRIES: '  ' })).toHaveLength(32);
    expect(() => stripeConnectCountries({ STRIPE_CONNECT_COUNTRIES: 'GB,Brasil' })).toThrow(/ISO 3166-1 alpha-2/);
    expect(() => stripeConnectCountries({ STRIPE_CONNECT_COUNTRIES: ',' })).toThrow(/ISO 3166-1 alpha-2/);
  });

  describe('stripeConnectAvailable', () => {
    const stripe = (country: string, stripeConnectedAccountId: string | null = null) => ({ provider: 'STRIPE', country, stripeConnectedAccountId });

    it("a Stripe payment account's own country decides — the one onboarding passes to Stripe", () => {
      expect(stripeConnectAvailable(stripe('GB'), 'BR', {})).toBe(true);
      expect(stripeConnectAvailable(stripe('BR'), 'GB', {})).toBe(false);
    });

    it('an account already connected keeps working wherever it is', () => {
      expect(stripeConnectAvailable(stripe('BR', 'acct_existing'), 'BR', {})).toBe(true);
    });

    it('with no Stripe payment account, the address country decides; none set stays available', () => {
      expect(stripeConnectAvailable(null, 'BR', {})).toBe(false);
      expect(stripeConnectAvailable(null, 'IE', {})).toBe(true);
      expect(stripeConnectAvailable({ provider: 'BANK_TRANSFER', country: 'GB', stripeConnectedAccountId: null }, 'BR', {})).toBe(false);
      expect(stripeConnectAvailable(null, null, {})).toBe(true);
      expect(stripeConnectAvailable(null, '', {})).toBe(true);
    });
  });
});
