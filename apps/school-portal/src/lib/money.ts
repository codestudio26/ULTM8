import { formatLocale } from '../i18n/format';

/**
 * Minor-unit money display. English (the default) keeps the plain
 * `${(minorUnits/100).toFixed(2)} CURRENCY` it always showed; another picked
 * language writes the amount the way that language does (`Intl.NumberFormat`:
 * its own separators and currency symbol, e.g. "US$89.99" / "89,99 $US").
 * Amounts are always stored in hundredths, so two decimals are kept even for a
 * zero-decimal currency, matching what English shows for the same row.
 */
export function formatMoney(minorUnits: number, currency: string | null | undefined): string {
  const locale = formatLocale();
  if (locale) {
    try {
      return new Intl.NumberFormat(locale, {
        ...(currency ? { style: 'currency', currency } : {}),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(minorUnits / 100);
    } catch {
      // An unknown currency code: fall back to the plain form below.
    }
  }
  return `${(minorUnits / 100).toFixed(2)}${currency ? ` ${currency}` : ''}`;
}
