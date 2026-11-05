import { moneyDigits, plainMoney } from '@ultm8/i18n';
import { formatLocale } from '../i18n/format';

/**
 * Minor-unit money display. English (the default) keeps the plain
 * `${(minorUnits/100).toFixed(2)} CURRENCY` it always showed; another picked
 * language writes the amount the way that language does (`Intl.NumberFormat`:
 * its own separators and currency symbol, e.g. "US$89.99" / "89,99 $US").
 * Amounts are always stored in hundredths; each currency shows its own
 * decimals (Decision 431, TXT-6): ¥12,345, not ¥12,345.00, while a fraction
 * of a yen kept from before Decision 431 still shows as ¥1,332.72.
 */
export function formatMoney(minorUnits: number, currency: string | null | undefined): string {
  const locale = formatLocale();
  if (locale) {
    try {
      return new Intl.NumberFormat(locale, {
        ...(currency ? { style: 'currency', currency } : {}),
        ...moneyDigits(currency),
      }).format(minorUnits / 100);
    } catch {
      // An unknown currency code: fall back to the plain form below.
    }
  }
  return `${plainMoney(minorUnits, currency)}${currency ? ` ${currency}` : ''}`;
}
