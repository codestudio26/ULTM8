import type { CountryCode } from 'libphonenumber-js';

/**
 * Best-effort initial country for `PhoneField`, from the device's own locale —
 * never a hardcoded single default country (this app serves Students worldwide).
 * No `expo-localization` dependency: Hermes (this app's JS engine, bundled with
 * ICU since the RN versions this app targets) already resolves `Intl`'s locale
 * APIs against the real device locale, so a second package isn't needed just for
 * this. Returns `undefined` (force an explicit choice) rather than guess wrong
 * when no usable region subtag is found.
 */
export function guessDefaultCountry(): CountryCode | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale; // e.g. "en-US"
    const region = locale.split('-').find((part) => /^[A-Z]{2}$/.test(part));
    if (region) return region as CountryCode;
  } catch {
    // Intl unavailable on this engine/build — fall through to no default.
  }
  return undefined;
}
