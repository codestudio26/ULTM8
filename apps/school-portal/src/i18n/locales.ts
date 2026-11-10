import { FORMAT_VARIANTS, SERVER_KEY_LOADERS, directionFor as sharedDirectionFor, resolveLocale as sharedResolveLocale } from '@ultm8/i18n';
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

/** The locales this portal can show: English, its formatting variants and
 * every catalogue above. */
function knownLocales(): string[] {
  return [DEFAULT_LOCALE, ...Object.keys(FORMAT_VARIANTS), ...Object.keys(LOCALE_LOADERS)];
}

/**
 * Decision 449 item 3 — before signing in, when no language has been chosen
 * in this browser, the browser's own language: the first of its languages
 * (`navigator.languages`, in the person's order) that is one of the 15
 * languages, matched exactly or by language (`pt` → `pt-BR`, `en-US` →
 * English), else null (English). The same matching as resolveLocale.
 */
export function browserLocale(languages: readonly string[] | undefined = readBrowserLanguages()): string | null {
  // The 15 languages, not the formatting variants: an "en-US" browser reads
  // English (UK), as before, until someone picks "English (US)".
  const known = [DEFAULT_LOCALE, ...Object.keys(LOCALE_LOADERS)];
  for (const tag of languages ?? []) {
    if (!tag) continue;
    const exact = known.find((code) => code.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const language = tag.split('-')[0].toLowerCase();
    const sameLanguage = known.find((code) => code.split('-')[0].toLowerCase() === language);
    if (sameLanguage) return sameLanguage;
  }
  return null;
}

function readBrowserLanguages(): readonly string[] | undefined {
  try {
    if (typeof navigator === 'undefined') return undefined;
    return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : undefined;
  } catch {
    return undefined;
  }
}

/** Picks the locale for a stored preference: an exact match first, then the
 * same language with any region (`pt` → `pt-BR`), else English. "English (US)"
 * (Decision 434) is a formatting variant: English text, US dates. */
export function resolveLocale(preferred: string | null | undefined): string {
  return sharedResolveLocale(preferred, knownLocales());
}
