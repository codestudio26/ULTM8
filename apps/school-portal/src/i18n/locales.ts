import type { PartialMessages } from './types';
import type { EnglishMessages } from './messages/en-GB';

/** The portal's own text catalogues, keyed by the same BCP-47 codes
 * GET /settings/languages serves. English ships in the main bundle (it's also
 * the fallback for every missing key); every other locale is loaded on demand,
 * so a user only downloads the language they picked. A code the server offers
 * but no catalogue exists for here yet simply shows English. */
export const DEFAULT_LOCALE = 'en-GB';

export const LOCALE_LOADERS: Record<string, () => Promise<PartialMessages<EnglishMessages>>> = {
  'pt-BR': () => import('./messages/pt-BR').then((m) => m.messages),
  es: () => import('./messages/es').then((m) => m.messages),
  ar: () => import('./messages/ar').then((m) => m.messages),
  fr: () => import('./messages/fr').then((m) => m.messages),
  de: () => import('./messages/de').then((m) => m.messages),
  it: () => import('./messages/it').then((m) => m.messages),
  nl: () => import('./messages/nl').then((m) => m.messages),
  pl: () => import('./messages/pl').then((m) => m.messages),
  ru: () => import('./messages/ru').then((m) => m.messages),
  tr: () => import('./messages/tr').then((m) => m.messages),
  ja: () => import('./messages/ja').then((m) => m.messages),
  ko: () => import('./messages/ko').then((m) => m.messages),
  'zh-CN': () => import('./messages/zh-CN').then((m) => m.messages),
  th: () => import('./messages/th').then((m) => m.messages),
};

/** Scripts written right to left. Matched on the language subtag, so `ar-EG`
 * is RTL too. */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function directionFor(locale: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}

/** Picks the catalogue for a stored preference: an exact match first, then the
 * same language with any region (`pt` → `pt-BR`), else English. */
export function resolveLocale(preferred: string | null | undefined): string {
  if (!preferred) return DEFAULT_LOCALE;
  const known = [DEFAULT_LOCALE, ...Object.keys(LOCALE_LOADERS)];
  const exact = known.find((code) => code.toLowerCase() === preferred.toLowerCase());
  if (exact) return exact;
  const language = preferred.split('-')[0].toLowerCase();
  return known.find((code) => code.split('-')[0].toLowerCase() === language) ?? DEFAULT_LOCALE;
}
