import { isISO31661Alpha2 } from 'class-validator';

/**
 * Decision 437 — the countries where Stripe can onboard a School's or a
 * Franchise's Connect Express account. The single source of truth for the API,
 * read by PaymentsService (onboarding is refused anywhere else, and every
 * payment-account / connect-status response says whether Connect is available)
 * and by the Dashboard's setup checklist.
 *
 * ULTM8's live Stripe platform is a UK account, and Connect Express onboarding
 * is ticked for 32 countries: the United Kingdom, the 27 EU member states,
 * Norway, Switzerland, Liechtenstein and Gibraltar. Brazil (and most of South
 * America) is not available to a UK platform: Schools there take cash or bank
 * transfer (Pix as a bank transfer) through the Cash/Bank flow staff confirm.
 *
 * Not an admin-maintained list (unlike the card-surcharge allow-list, Decision
 * 419, which is a legal call made per country): this one mirrors what is
 * ticked in the Stripe Dashboard, so it changes with a deploy. The
 * `STRIPE_CONNECT_COUNTRIES` environment variable (comma-separated ISO 3166-1
 * alpha-2 codes) replaces the default when set, e.g. for a test environment.
 */
export const DEFAULT_STRIPE_CONNECT_COUNTRIES: readonly string[] = [
  'GB',
  // The 27 EU member states.
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'NO', 'CH', 'LI', 'GI',
];

export const STRIPE_CONNECT_COUNTRIES_ENV = 'STRIPE_CONNECT_COUNTRIES';

/**
 * The allowed countries, upper case and sorted. Throws when
 * `STRIPE_CONNECT_COUNTRIES` is set but holds something that isn't an ISO
 * 3166-1 alpha-2 code (validate-env reports the same at start-up in
 * production), rather than silently allowing or refusing a country.
 */
export function stripeConnectCountries(env: Record<string, unknown> = process.env): string[] {
  const raw = env[STRIPE_CONNECT_COUNTRIES_ENV];
  if (typeof raw !== 'string' || raw.trim() === '') return [...DEFAULT_STRIPE_CONNECT_COUNTRIES].sort();
  const codes = raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c !== '');
  const invalid = codes.filter((c) => !isISO31661Alpha2(c));
  if (invalid.length > 0 || codes.length === 0) {
    throw new Error(`${STRIPE_CONNECT_COUNTRIES_ENV} must be comma-separated ISO 3166-1 alpha-2 country codes (not: ${invalid.join(', ') || 'empty'})`);
  }
  return [...new Set(codes)].sort();
}

/** An ISO 3166-1 alpha-2 code in capitals, or null when `country` isn't one. */
export function normalizeCountryCode(country: string | null | undefined): string | null {
  if (typeof country !== 'string') return null;
  const code = country.trim().toUpperCase();
  return isISO31661Alpha2(code) ? code : null;
}

export function isStripeConnectCountry(country: string | null | undefined, env: Record<string, unknown> = process.env): boolean {
  const code = normalizeCountryCode(country);
  return code !== null && stripeConnectCountries(env).includes(code);
}

/**
 * Whether the Connect Stripe button may show for a School or Franchise.
 *
 *  - An account that already has a Stripe connected account keeps working
 *    wherever it is (none are expected outside the list).
 *  - A Stripe payment account without one: its own `country`, the one
 *    onboarding passes to Stripe's accounts.create().
 *  - No Stripe payment account yet: the School's or Franchise's address
 *    country. With no address country either it stays available, and the
 *    country picked when connecting is limited to the list (and checked again
 *    when onboarding starts).
 */
export function stripeConnectAvailable(
  paymentAccount: { provider: string; country: string; stripeConnectedAccountId: string | null } | null,
  addressCountry: string | null | undefined,
  env: Record<string, unknown> = process.env,
): boolean {
  if (paymentAccount?.provider === 'STRIPE') {
    if (paymentAccount.stripeConnectedAccountId) return true;
    return isStripeConnectCountry(paymentAccount.country, env);
  }
  if (addressCountry == null || addressCountry.trim() === '') return true;
  return isStripeConnectCountry(addressCountry, env);
}
