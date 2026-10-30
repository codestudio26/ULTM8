/**
 * Standard VAT / GST / sales-tax rates ULTM8 pre-fills when a School picks the
 * country it is in (Decision 411). Only a starting point: the School can
 * change its rate (classes are often taxed at a reduced or zero rate, and a
 * small School may not be registered at all), and each charge keeps the rate
 * it was created with.
 *
 * Rates are in hundredths of a percent (2000 = 20%).
 *
 * Source: compiled 30 Oct 2026 from the national standard rates as published
 * by each country's tax authority, the European Commission's "VAT rates
 * applied in the Member States" table and the OECD "Consumption Tax Trends"
 * VAT/GST rate table, as known to the author. The official pages could not be
 * reached while this list was written (no web access), so every rate below is
 * marked unverified and must be checked against those sources before launch.
 *
 * Countries with no single national VAT or GST pre-fill 0, and the School
 * types its own rate: the United States (state and local sales taxes only),
 * Brazil (no single national rate until the CBS/IBS reform is in force),
 * Hong Kong, Qatar and Kuwait (no VAT).
 */
export interface StandardTaxRate {
  /** ISO 3166-1 alpha-2. */
  country: string;
  rateBasisPoints: number;
  /** false: the country has no single national rate; 0 is a placeholder. */
  national: boolean;
}

const rate = (country: string, rateBasisPoints: number): StandardTaxRate => ({ country, rateBasisPoints, national: true });
const none = (country: string): StandardTaxRate => ({ country, rateBasisPoints: 0, national: false });

export const STANDARD_TAX_RATES: readonly StandardTaxRate[] = [
  // European Union
  rate('AT', 2000), // unverified — check before launch
  rate('BE', 2100), // unverified — check before launch
  rate('BG', 2000), // unverified — check before launch
  rate('HR', 2500), // unverified — check before launch
  rate('CY', 1900), // unverified — check before launch
  rate('CZ', 2100), // unverified — check before launch
  rate('DK', 2500), // unverified — check before launch
  rate('EE', 2400), // unverified — check before launch (24% from July 2025)
  rate('FI', 2550), // unverified — check before launch (25.5% from Sept 2024)
  rate('FR', 2000), // unverified — check before launch
  rate('DE', 1900), // unverified — check before launch
  rate('GR', 2400), // unverified — check before launch
  rate('HU', 2700), // unverified — check before launch
  rate('IE', 2300), // unverified — check before launch
  rate('IT', 2200), // unverified — check before launch
  rate('LV', 2100), // unverified — check before launch
  rate('LT', 2100), // unverified — check before launch
  rate('LU', 1700), // unverified — check before launch
  rate('MT', 1800), // unverified — check before launch
  rate('NL', 2100), // unverified — check before launch
  rate('PL', 2300), // unverified — check before launch
  rate('PT', 2300), // unverified — check before launch (mainland)
  rate('RO', 2100), // unverified — check before launch (21% from Aug 2025)
  rate('SK', 2300), // unverified — check before launch (23% from Jan 2025)
  rate('SI', 2200), // unverified — check before launch
  rate('ES', 2100), // unverified — check before launch (mainland)
  rate('SE', 2500), // unverified — check before launch
  // Rest of Europe
  rate('GB', 2000), // unverified — check before launch
  rate('NO', 2500), // unverified — check before launch
  rate('CH', 810), // unverified — check before launch
  rate('LI', 810), // unverified — check before launch
  rate('IS', 2400), // unverified — check before launch
  rate('RS', 2000), // unverified — check before launch
  rate('UA', 2000), // unverified — check before launch
  rate('GE', 1800), // unverified — check before launch
  rate('TR', 2000), // unverified — check before launch
  rate('RU', 2200), // unverified — check before launch (22% from Jan 2026)
  // Americas
  none('US'), // no national VAT: state and local sales taxes only; the School types its own rate
  rate('CA', 500), // unverified — check before launch (federal GST only; provinces add PST or charge HST instead)
  rate('MX', 1600), // unverified — check before launch
  none('BR'), // no single national rate (ICMS/ISS/PIS/COFINS, CBS/IBS reform phasing in); the School types its own rate
  rate('AR', 2100), // unverified — check before launch
  rate('CL', 1900), // unverified — check before launch
  rate('CO', 1900), // unverified — check before launch
  rate('PE', 1800), // unverified — check before launch (IGV 16% + IPM 2%)
  rate('UY', 2200), // unverified — check before launch
  rate('PY', 1000), // unverified — check before launch
  rate('BO', 1300), // unverified — check before launch
  rate('EC', 1500), // unverified — check before launch (15% from April 2024)
  rate('CR', 1300), // unverified — check before launch
  rate('PA', 700), // unverified — check before launch
  rate('GT', 1200), // unverified — check before launch
  rate('DO', 1800), // unverified — check before launch
  // Asia and Oceania
  rate('AU', 1000), // unverified — check before launch
  rate('NZ', 1500), // unverified — check before launch
  rate('JP', 1000), // unverified — check before launch
  rate('KR', 1000), // unverified — check before launch
  rate('CN', 1300), // unverified — check before launch
  rate('TW', 500), // unverified — check before launch
  none('HK'), // no VAT or GST; the School types its own rate
  rate('SG', 900), // unverified — check before launch (9% from Jan 2024)
  rate('MY', 800), // unverified — check before launch (service tax; no VAT)
  rate('TH', 700), // unverified — check before launch
  rate('ID', 1100), // unverified — check before launch (12% applies only to luxury goods from 2025)
  rate('PH', 1200), // unverified — check before launch
  rate('VN', 1000), // unverified — check before launch (temporarily 8% for many goods)
  rate('IN', 1800), // unverified — check before launch (GST standard slab)
  // Middle East and Africa
  rate('AE', 500), // unverified — check before launch
  rate('SA', 1500), // unverified — check before launch
  rate('BH', 1000), // unverified — check before launch
  rate('OM', 500), // unverified — check before launch
  none('QA'), // no VAT; the School types its own rate
  none('KW'), // no VAT; the School types its own rate
  rate('IL', 1800), // unverified — check before launch (18% from Jan 2025)
  rate('EG', 1400), // unverified — check before launch
  rate('MA', 2000), // unverified — check before launch
  rate('ZA', 1500), // unverified — check before launch
  rate('NG', 750), // unverified — check before launch
  rate('KE', 1600), // unverified — check before launch
];

/** The pre-fill for a country, or null when ULTM8's list doesn't have it. */
export function standardTaxRateFor(country: string | null | undefined): StandardTaxRate | null {
  if (!country) return null;
  return STANDARD_TAX_RATES.find((r) => r.country === country.toUpperCase()) ?? null;
}
