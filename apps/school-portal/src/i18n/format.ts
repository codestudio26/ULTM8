/**
 * The locale dates and times are written in. English (UK), the default, returns
 * `undefined` so those keep following the browser's own settings exactly as
 * before; any other picked language formats dates in that language.
 * `I18nProvider` sets it on every render, ahead of the pages that read it.
 */
let current: string | undefined;

export function setFormatLocale(locale: string | undefined): void {
  current = locale;
}

export function formatLocale(): string | undefined {
  return current;
}

/** A language from GET /settings/languages, named in the picked language
 * ("英語（イギリス）"); English keeps the server's own name. */
export function languageName(code: string, serverName: string): string {
  if (!current) return serverName;
  try {
    return new Intl.DisplayNames([current], { type: 'language' }).of(code) ?? serverName;
  } catch {
    return serverName;
  }
}

/** A country by its ISO code ("GB" → "United Kingdom"), named in the picked language. */
export function countryDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames([current ?? 'en-GB'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
