import { DEFAULT_LOCALE, SERVER_KEY_LOADERS, resolveLocale as sharedResolveLocale, type PartialMessages } from '@ultm8/i18n';
import type { EnglishMessages } from './messages/en';

export { DEFAULT_LOCALE };

/** A locale's catalogue with the API's `server` text from `@ultm8/i18n`. */
function withServerText(code: string, catalogue: Promise<{ messages: PartialMessages<EnglishMessages> }>): Promise<PartialMessages<EnglishMessages>> {
  return Promise.all([catalogue, SERVER_KEY_LOADERS[code]()]).then(([m, server]) => ({ ...m.messages, server }));
}

/** The app's own text in the 14 other languages (Decision 323), loaded on
 * demand. English ships in the bundle and fills any missing key. */
export const LOCALE_LOADERS: Record<string, () => Promise<PartialMessages<EnglishMessages>>> = {
  'pt-BR': () => withServerText('pt-BR', import('./messages/pt-BR')),
  es: () => withServerText('es', import('./messages/es')),
  ar: () => withServerText('ar', import('./messages/ar')),
  fr: () => withServerText('fr', import('./messages/fr')),
  de: () => withServerText('de', import('./messages/de')),
  it: () => withServerText('it', import('./messages/it')),
  nl: () => withServerText('nl', import('./messages/nl')),
  pl: () => withServerText('pl', import('./messages/pl')),
  ru: () => withServerText('ru', import('./messages/ru')),
  tr: () => withServerText('tr', import('./messages/tr')),
  ja: () => withServerText('ja', import('./messages/ja')),
  ko: () => withServerText('ko', import('./messages/ko')),
  'zh-CN': () => withServerText('zh-CN', import('./messages/zh-CN')),
  th: () => withServerText('th', import('./messages/th')),
};

export function resolveLocale(preferred: string | null | undefined): string {
  return sharedResolveLocale(preferred, [DEFAULT_LOCALE, ...Object.keys(LOCALE_LOADERS)]);
}

/** The phone's language (Decision 323 item 2). Hermes' `Intl` reports the
 * device locale; anything unexpected reads as no preference. */
export function deviceLocale(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}
