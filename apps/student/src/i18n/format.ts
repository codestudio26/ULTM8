/** The app's picked locale for dates and money (Decision 323), set by the
 * I18nProvider. `undefined` means the phone's own settings, as before. */
let current: string | undefined;

export function setFormatLocale(locale: string | undefined) {
  current = locale;
}

export function formatLocale(): string | undefined {
  return current;
}
