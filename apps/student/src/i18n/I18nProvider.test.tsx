import React from 'react';
import { Text } from 'react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as auth from '../auth/AuthContext';
import * as locales from './locales';
import { I18nProvider, useI18n } from './I18nProvider';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../api', () => ({ apiClient: { GET: jest.fn() } }));
jest.mock('./locales', () => {
  const actual = jest.requireActual('./locales') as typeof import('./locales');
  return { ...actual, deviceLocale: jest.fn() };
});

jest.setTimeout(30_000);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { GET: jest.Mock } };
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const ok = (data: unknown) => Promise.resolve({ data, response: new Response(null, { status: 200 }) });

function Probe() {
  const { t, locale } = useI18n();
  return (
    <>
      <Text testID="locale">{locale}</Text>
      <Text testID="title">{t('home.title' as never)}</Text>
    </>
  );
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Probe />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

let profileLanguage: string | null = null;
let overrides: Array<{ screen: string; labelKey: string; content: string }> = [];

beforeEach(() => {
  jest.clearAllMocks();
  profileLanguage = null;
  overrides = [];
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] } });
  mocked(locales.deviceLocale).mockReturnValue('en-US');
  apiClient.GET.mockImplementation(((path: string) =>
    path === '/v1/users/me' ? ok({ id: 'me', language: profileLanguage }) : ok({ items: overrides, nextCursor: null })) as never);
});

describe('I18nProvider (Decision 323)', () => {
  it("uses the phone's language when the account has none", async () => {
    mocked(locales.deviceLocale).mockReturnValue('es-MX');
    const { getByTestId } = await renderProbe();
    await waitFor(() => expect(getByTestId('locale').props.children).toBe('es'));
  });

  it("the account's saved language wins over the phone's", async () => {
    profileLanguage = 'pt-BR';
    mocked(locales.deviceLocale).mockReturnValue('de-DE');
    const { getByTestId } = await renderProbe();
    await waitFor(() => expect(getByTestId('locale').props.children).toBe('pt-BR'));
  });

  it('English when the phone language is not one of the 15', async () => {
    mocked(locales.deviceLocale).mockReturnValue('sw-KE');
    const { getByTestId } = await renderProbe();
    await waitFor(() => expect(apiClient.GET).toHaveBeenCalled());
    expect(getByTestId('locale').props.children).toBe('en-GB');
  });

  it('a Platform Admin row under studentApp.* replaces the built-in text; a portal row does not', async () => {
    overrides = [
      { screen: 'home', labelKey: 'title', content: 'Portal wording' },
      { screen: 'studentApp.home', labelKey: 'title', content: 'App wording' },
    ];
    const { getByTestId } = await renderProbe();
    await waitFor(() => expect(getByTestId('title').props.children).toBe('App wording'));
  });
});
