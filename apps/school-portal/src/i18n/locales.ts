import { SERVER_KEY_LOADERS, directionFor as sharedDirectionFor, resolveLocale as sharedResolveLocale } from '@ultm8/i18n';
import type { PartialMessages } from './types';
import type { EnglishMessages } from './messages/en-GB';

/** A locale's catalogue with its `server` text, which lives in `@ultm8/i18n`
 * so the student app shares it (Decision 323). */
function withServerText(code: string, catalogue: Promise<{ messages: PartialMessages<EnglishMessages> }>): Promise<PartialMessages<EnglishMessages>> {
  return Promise.all([catalogue, SERVER_KEY_LOADERS[code]()]).then(([m, server]) => ({ ...m.messages, server }));
}

/** The portal's own text catalogues, keyed by the same BCP-47 codes
 * GET /settings/languages serves. English ships in the main bundle (it's also
 * the fallback for every missing key); every other locale is loaded on demand,
 * so a user only downloads the language they picked. A code the server offers
 * but no catalogue exists for here yet simply shows English. */
export const DEFAULT_LOCALE = 'en-GB';

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

export const directionFor = sharedDirectionFor;

/** Picks the catalogue for a stored preference: an exact match first, then the
 * same language with any region (`pt` → `pt-BR`), else English. */
export function resolveLocale(preferred: string | null | undefined): string {
  return sharedResolveLocale(preferred, [DEFAULT_LOCALE, ...Object.keys(LOCALE_LOADERS)]);
}
