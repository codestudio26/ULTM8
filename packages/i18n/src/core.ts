import type { Message, MessageTree, MessageVars } from './types';

/** English (UK): the source text, and the fallback for any missing key. */
export const DEFAULT_LOCALE = 'en-GB';

/** The 15 languages (Decision 273 item 2), as BCP-47 codes from GET /settings/languages. */
export const SUPPORTED_LOCALES = ['en-GB', 'pt-BR', 'es', 'ar', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'ja', 'ko', 'zh-CN', 'th'] as const;

/** Scripts written right to left. Matched on the language subtag, so `ar-EG`
 * is RTL too. */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function directionFor(locale: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';
}

/** Picks the catalogue for a preference: an exact match first, then the same
 * language with any region (`pt` → `pt-BR`), else English. */
export function resolveLocale(preferred: string | null | undefined, known: readonly string[] = SUPPORTED_LOCALES): string {
  if (!preferred) return DEFAULT_LOCALE;
  const exact = known.find((code) => code.toLowerCase() === preferred.toLowerCase());
  if (exact) return exact;
  const language = preferred.split('-')[0].toLowerCase();
  return known.find((code) => code.split('-')[0].toLowerCase() === language) ?? DEFAULT_LOCALE;
}

/** The message at a dotted key, or undefined. */
export function lookup(tree: unknown, key: string): Message | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && typeof (node as { other?: unknown }).other === 'string') return node as Message;
  return undefined;
}

/** Fills `{name}` from `vars`; a plural message is picked by `vars.count`
 * with `Intl.PluralRules`. */
export function formatMessage(message: Message, locale: string, vars?: MessageVars): string {
  let text: string;
  if (typeof message === 'string') {
    text = message;
  } else {
    const count = typeof vars?.count === 'number' ? vars.count : 0;
    const category = new Intl.PluralRules(locale).select(count);
    text = message[category] ?? message.other;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export type { MessageTree };
