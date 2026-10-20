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
