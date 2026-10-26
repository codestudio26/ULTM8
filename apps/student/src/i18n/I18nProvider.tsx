import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { I18nManager } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { setApiErrorMessageTranslator, unwrap } from '@ultm8/api-client';
import {
  SERVER_MESSAGE_LOADERS,
  createServerTextTranslator,
  directionFor,
  formatMessage,
  lookup,
  type MessageVars,
  type ServerTextTranslator,
} from '@ultm8/i18n';
import { apiClient } from '../api';
import { useAuth } from '../auth/AuthContext';
import { messages as english } from './messages/en';
import { DEFAULT_LOCALE, LOCALE_LOADERS, deviceLocale, resolveLocale } from './locales';
import { setFormatLocale } from './format';
import type { TranslateFn } from './types';

/**
 * The student app's translation layer (Decision 323), the same shape as the
 * School Portal's (Decision 273). Lookup order for every key: a Platform Admin
 * Translation row for the current locale → this app's own catalogue for that
 * locale → English, so a missing translation shows English, never a blank.
 *
 * Platform Admin rows reach this app under the `studentApp` screen prefix: a
 * row with screen `studentApp.home` and labelKey `title` overrides
 * `home.title` here, and never the portal's own `home.title`.
 *
 * Which locale: the signed-in person's saved `language` (GET /users/me, set
 * from Profile), else the phone's language, else English.
 */

export const OVERRIDE_PREFIX = 'studentApp.';

interface I18nContextValue {
  locale: string;
  dir: 'ltr' | 'rtl';
  t: TranslateFn;
  /** The API's own English text (errors, job-written notifications) in this
   * locale; English passes it through unchanged. */
  serverText: ServerTextTranslator;
}

const PASS_THROUGH: ServerTextTranslator = {
  error: (_status, _code, message) => message,
  notification: ({ title, body }) => ({ title, body }),
};

function englishT(key: string, vars?: MessageVars): string {
  const message = lookup(english, key);
  return message === undefined ? key : formatMessage(message, DEFAULT_LOCALE, vars);
}

const FALLBACK: I18nContextValue = { locale: DEFAULT_LOCALE, dir: 'ltr', t: englishT as TranslateFn, serverText: PASS_THROUGH };

/** Every server Translation row for one locale, across all pages, keyed as
 * `${screen}.${labelKey}`. */
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

const I18nContext = createContext<I18nContextValue>(FALLBACK);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { claims } = useAuth();
  // The same query key as Profile's useMyProfile, so a saved language applies at once.
  const me = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => unwrap(apiClient.GET('/v1/users/me')),
    enabled: !!claims,
  });
  const locale = resolveLocale((claims ? me.data?.language : null) ?? deviceLocale());
  const dir = directionFor(locale);
  setFormatLocale(locale === DEFAULT_LOCALE ? undefined : locale);

  const catalogue = useQuery({
    queryKey: ['i18n', 'catalogue', locale],
    queryFn: () => LOCALE_LOADERS[locale]!(),
    enabled: locale !== DEFAULT_LOCALE,
    staleTime: Infinity,
  });
  const overrides = useQuery({
    queryKey: ['i18n', 'overrides', locale],
    queryFn: () => fetchOverrides(locale),
    staleTime: 10 * 60_000,
    retry: false,
  });

  // React Native flips the layout for Arabic only after the app restarts;
  // Profile says so when the direction changes.
  useEffect(() => {
    const rtl = dir === 'rtl';
    if (I18nManager.isRTL !== rtl) {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
    }
  }, [dir]);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const message = overrides.data?.[OVERRIDE_PREFIX + key] ?? lookup(catalogue.data, key) ?? lookup(english, key);
      return message === undefined ? key : formatMessage(message, locale, vars);
    },
    [overrides.data, catalogue.data, locale],
  );

  const serverText = useMemo(
    () =>
      locale === DEFAULT_LOCALE
        ? PASS_THROUGH
        : createServerTextTranslator(t as (key: string, vars?: MessageVars) => string, locale, SERVER_MESSAGE_LOADERS[locale]),
    [t, locale],
  );
  // Every request's error message is rewritten where it is built
  // (@ultm8/api-client's unwrap), so each screen's error display needs no change.
  setApiErrorMessageTranslator((status, code, message) => serverText.error(status, code, message));
  setCurrentTranslate(t);

  const value = useMemo(() => ({ locale, dir, t, serverText }), [locale, dir, t, serverText]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** `const t = useT(); t('home.title')`. Outside the provider (tests) it reads English. */
export function useT(): TranslateFn {
  return useI18n().t;
}

/** For code outside React (error helpers): English unless the provider has set the current one. */
let currentT: TranslateFn = englishT as TranslateFn;
export function translate(key: Parameters<TranslateFn>[0], vars?: MessageVars): string {
  return currentT(key, vars);
}
export function setCurrentTranslate(t: TranslateFn) {
  currentT = t;
}
