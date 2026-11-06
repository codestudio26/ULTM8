import { COUNTRY_NAMES } from '@ultm8/ui';
import { formatLocale } from '../i18n/format';

/** Country names in the portal's language, falling back to English, sorted
 * by name. Used by the Connect Stripe country pickers (Franchise and School). */
export function localCountryNames(): Array<{ value: string; label: string }> {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([formatLocale() ?? 'en'], { type: 'region' });
  } catch {
    names = null;
  }
  return COUNTRY_NAMES.map(([code, name]) => ({ value: code, label: names?.of(code) ?? name })).sort((a, b) => a.label.localeCompare(b.label));
}
