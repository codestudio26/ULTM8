import type { CountryCode } from 'libphonenumber-js';

/**
 * Best-effort initial country for `PhoneField`, from the browser's own locale —
 * never a hardcoded single default country (this app serves Schools worldwide).
 * Returns `undefined` (force an explicit choice) rather than guess wrong when the
 * locale carries no region subtag, e.g. a bare `"en"`.
 */
export function guessDefaultCountry(): CountryCode | undefined {
  try {
    const locales = typeof navigator !== 'undefined' && navigator.languages?.length ? navigator.languages : [navigator?.language];
    for (const locale of locales) {
      if (!locale) continue;
      const region = locale.split('-').find((part) => /^[A-Z]{2}$/.test(part));
      if (region) return region as CountryCode;
    }
  } catch {
    // navigator unavailable (e.g. SSR/tests) — fall through to no default.
  }
  return undefined;
}
