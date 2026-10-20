import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setApiErrorMessageTranslator, unwrap } from '@ultm8/api-client';
import { DEFAULT_UI_STRINGS, UiStringsProvider, type UiStrings } from '@ultm8/ui';
import { apiClient } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useCurrentUser } from '../auth/currentUserQueries';
import { messages as english, type EnglishMessages } from './messages/en-GB';
import { DEFAULT_LOCALE, LOCALE_LOADERS, directionFor, resolveLocale } from './locales';
import { setFormatLocale } from './format';
import { SERVER_MESSAGE_LOADERS, createServerTextTranslator, type ServerTextTranslator } from './server/translate';
import type { Message, MessageKey, MessageTree, MessageVars, PartialMessages } from './types';

/**
 * The portal's translation layer (product-owner decision, 20 Oct 2026: text
 * ships built in, and wording a Platform Admin edits in the Translations tool
 * replaces it). Lookup order for every key: a server Translation for the
 * current locale → this app's own catalogue for that locale → English. A
 * missing translation therefore always falls back to readable English, never
 * to a blank or a raw key.
 *
 * Server rows map onto keys as `${screen}.${labelKey}` — a row with screen
 * `notifications` and labelKey `title` overrides `notifications.title`.
 *
 * Which locale: the signed-in user's saved `language` (GET /users/me), or —
 * before login, when there's no profile to read — the last choice made in
 * this browser, kept in localStorage.
 */

export type TranslationKey = MessageKey<EnglishMessages>;
export type TranslateFn = (key: TranslationKey, vars?: MessageVars) => string;

interface I18nContextValue {
  locale: string;
  dir: 'ltr' | 'rtl';
  t: TranslateFn;
  /** Remembers a choice in this browser; saving it to the profile is the
   * caller's job (the header's language picker already does that). */
  rememberLocale: (code: string) => void;
  /** The API's own English text (errors, job-written notifications) in this
   * locale; English passes it through unchanged. */
  serverText: ServerTextTranslator;
}

const PASS_THROUGH: ServerTextTranslator = {
  error: (_status, _code, message) => message,
  notification: ({ title, body }) => ({ title, body }),
};

const STORAGE_KEY = 'ultm8.language';

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function lookup(tree: MessageTree | PartialMessages<EnglishMessages> | undefined, key: string): Message | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && typeof (node as { other?: unknown }).other === 'string') return node as Message;
  return undefined;
}

function format(message: Message, locale: string, vars?: MessageVars): string {
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

/** Every server Translation row for one locale, across all pages. */
async function fetchOverrides(locale: string): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const page = await unwrap(apiClient.GET('/v1/translations', { params: { query: { locale, limit: 100, cursor } } }));
    for (const row of page.items) overrides[`${row.screen}.${row.labelKey}`] = row.content;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return overrides;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { claims } = useAuth();
  const { data: me } = useCurrentUser({ enabled: !!claims });
  const [storedLocale, setStoredLocale] = useState(readStoredLocale);
  const locale = resolveLocale((claims ? me?.language : null) ?? storedLocale);
  const dir = directionFor(locale);
  setFormatLocale(locale === DEFAULT_LOCALE ? undefined : locale);

  const catalogue = useQuery({
    queryKey: ['i18n', 'catalogue', locale],
    queryFn: () => LOCALE_LOADERS[locale]!(),
    enabled: locale !== DEFAULT_LOCALE,
    staleTime: Infinity,
  });
  const serverMessages = useQuery({
    queryKey: ['i18n', 'server', locale],
    queryFn: () => SERVER_MESSAGE_LOADERS[locale]!(),
    enabled: locale !== DEFAULT_LOCALE && !!SERVER_MESSAGE_LOADERS[locale],
    staleTime: Infinity,
  });
  const overrides = useQuery({
    queryKey: ['i18n', 'overrides', locale],
    queryFn: () => fetchOverrides(locale),
    staleTime: 10 * 60_000,
    retry: false,
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const rememberLocale = useCallback((code: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Private mode or storage disabled: the choice still applies for this visit.
    }
    setStoredLocale(code);
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const message =
        overrides.data?.[key] ?? lookup(catalogue.data, key) ?? lookup(english as unknown as MessageTree, key);
      return message === undefined ? key : format(message, locale, vars);
    },
    [overrides.data, catalogue.data, locale],
  );

  const serverText = useMemo(
    () =>
      locale === DEFAULT_LOCALE
        ? PASS_THROUGH
        : createServerTextTranslator(t as (key: string, vars?: MessageVars) => string, locale, serverMessages.data),
    [t, locale, serverMessages.data],
  );
  // Error messages are rewritten where every request's error is built
  // (@ultm8/api-client's unwrap), so each page's own error display needs no change.
  setApiErrorMessageTranslator(locale === DEFAULT_LOCALE ? null : serverText.error);

  // The browser tab's title, which index.html starts in English.
  useEffect(() => {
    document.title = t('layout.brand');
  }, [t]);

  const value = useMemo(() => ({ locale, dir, t, rememberLocale, serverText }), [locale, dir, t, rememberLocale, serverText]);
  // The shared `@ultm8/ui` components read their text from this, so they follow
  // the picker too. English keeps the package's own country names and order.
  const uiStrings = useMemo(
    () =>
      Object.fromEntries(Object.keys(DEFAULT_UI_STRINGS).map((k) => [k, t(`ui.${k}` as TranslationKey)])) as UiStrings,
    [t],
  );
  return (
    <I18nContext.Provider value={value}>
      <UiStringsProvider strings={uiStrings} locale={locale === DEFAULT_LOCALE ? undefined : locale}>
        {children}
      </UiStringsProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Shorthand for the common case: `const t = useT(); t('notifications.title')`. */
export function useT(): TranslateFn {
  return useI18n().t;
}
