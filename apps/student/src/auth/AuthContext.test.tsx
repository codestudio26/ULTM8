import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from './AuthContext';
import { ACCESS_TOKEN_EXPIRY_BUFFER_MS } from './tokenExpiry';

/**
 * Covers the on-launch proactive-refresh path (Track B roadmap's own flagged
 * "Not yet" item) end to end: a near-expired/expired stored token must be
 * refreshed BEFORE AuthProvider ever reports `loading: false` with that stale
 * token applied — not left for the first real API call to 401 into the
 * existing reactive path (already covered by apiClientRefresh.test.ts, which
 * this test deliberately does not re-test). `isAccessTokenExpiredOrNearExpiry`
 * itself is unit-tested directly in tokenExpiry.test.ts; this proves
 * AuthContext actually calls it and acts on the result.
 */
jest.mock('./secureTokenStore', () => ({
  secureTokenStore: {
    get: jest.fn(),
    set: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
    getRefreshToken: jest.fn(async () => 'stored-refresh-token'),
    setRefreshToken: jest.fn(async () => undefined),
  },
}));
jest.mock('../api', () => ({
  authClient: { POST: jest.fn() },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('../lib/queryPersister', () => ({
  asyncStoragePersister: { removeClient: jest.fn(async () => undefined) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { secureTokenStore } = require('./secureTokenStore') as {
  secureTokenStore: { get: ReturnType<typeof jest.fn>; getRefreshToken: ReturnType<typeof jest.fn> };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authClient } = require('../api') as { authClient: { POST: ReturnType<typeof jest.fn> } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AsyncStorage = require('@react-native-async-storage/async-storage') as {
  getItem: ReturnType<typeof jest.fn>;
  setItem: ReturnType<typeof jest.fn>;
  removeItem: ReturnType<typeof jest.fn>;
};

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeToken(exp: number, sub = 'u1'): string {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub, email: 'a@b.com', grants: [], exp }));
  return `${header}.${payload}.fake-signature`;
}

function okResponse<T>(data: T) {
  return Promise.resolve({ data, response: { ok: true, status: 201 } as Response });
}

let activeQueryClient: QueryClient | undefined;

async function renderAuth() {
  const queryClient = new QueryClient();
  activeQueryClient = queryClient;
  return renderHook(() => useAuth(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    ),
  });
}

describe('AuthProvider — on-launch proactive refresh', () => {
  beforeEach(() => {
    secureTokenStore.get.mockReset();
    secureTokenStore.getRefreshToken.mockReset().mockResolvedValue('stored-refresh-token');
    authClient.POST.mockReset();
  });

  afterEach(() => {
    activeQueryClient?.clear();
    activeQueryClient = undefined;
  });

  it('applies a token that is not near expiry as-is, with no refresh call', async () => {
    const token = fakeToken(Math.floor(Date.now() / 1000) + 15 * 60);
    secureTokenStore.get.mockResolvedValue(token);

    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.accessToken).toBe(token);
    expect(authClient.POST).not.toHaveBeenCalled();
  });

  it('proactively refreshes a token already within the expiry buffer BEFORE loading clears, applying the new token', async () => {
    const staleToken = fakeToken(Math.floor((Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS / 2) / 1000));
    const freshToken = fakeToken(Math.floor(Date.now() / 1000) + 15 * 60);
    secureTokenStore.get.mockResolvedValue(staleToken);
    authClient.POST.mockImplementation((path: string) => {
      if (path === '/v1/auth/refresh') {
        return okResponse({ accessToken: freshToken, refreshToken: 'rotated-refresh-token' });
      }
      throw new Error(`unexpected call: ${path}`);
    });

    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(authClient.POST).toHaveBeenCalledWith('/v1/auth/refresh', { body: { refreshToken: 'stored-refresh-token' } });
    // Never the stale token — proactive refresh happens before `loading`
    // clears, not after an already-stale token was briefly applied.
    expect(result.current.accessToken).toBe(freshToken);
  });

  it('logs out cleanly when the stored refresh token is also no good (e.g. a 30-day-expired/offline device)', async () => {
    const staleToken = fakeToken(Math.floor((Date.now() - 1000) / 1000));
    secureTokenStore.get.mockResolvedValue(staleToken);
    authClient.POST.mockImplementation(() => Promise.reject(new Error('refresh token invalid')));

    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.accessToken).toBeNull();
  });
});

describe('AuthProvider — pendingSchoolPick (Decision 266)', () => {
  beforeEach(() => {
    secureTokenStore.get.mockReset().mockResolvedValue(null);
    secureTokenStore.getRefreshToken.mockReset().mockResolvedValue(null);
    authClient.POST.mockReset();
    AsyncStorage.getItem.mockReset().mockResolvedValue(null);
    AsyncStorage.setItem.mockReset().mockResolvedValue(undefined);
    AsyncStorage.removeItem.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    activeQueryClient?.clear();
    activeQueryClient = undefined;
  });

  it('a previously persisted pick is loaded on launch, without blocking on `loading`', async () => {
    AsyncStorage.getItem.mockImplementation((key: string) =>
      Promise.resolve(key === 'ultm8.pendingSchoolPick' ? JSON.stringify({ id: 'dojo-1', name: 'Alpha Dojo' }) : null),
    );

    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.pendingSchoolPick).toEqual({ id: 'dojo-1', name: 'Alpha Dojo' }));
  });

  it('setPendingSchoolPick updates state immediately and persists to AsyncStorage under its own key', async () => {
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setPendingSchoolPick({ id: 'dojo-2', name: 'Beta Dojo' });
    });

    expect(result.current.pendingSchoolPick).toEqual({ id: 'dojo-2', name: 'Beta Dojo' });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('ultm8.pendingSchoolPick', JSON.stringify({ id: 'dojo-2', name: 'Beta Dojo' }));
  });

  it('clearPendingSchoolPick clears state and removes the stored value', async () => {
    AsyncStorage.getItem.mockImplementation((key: string) =>
      Promise.resolve(key === 'ultm8.pendingSchoolPick' ? JSON.stringify({ id: 'dojo-1', name: 'Alpha Dojo' }) : null),
    );
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.pendingSchoolPick).not.toBeNull());

    await act(async () => {
      result.current.clearPendingSchoolPick();
    });

    expect(result.current.pendingSchoolPick).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('ultm8.pendingSchoolPick');
  });

  it('logout does NOT clear a pending School pick — it is intent, not a session artifact', async () => {
    AsyncStorage.getItem.mockImplementation((key: string) =>
      Promise.resolve(key === 'ultm8.pendingSchoolPick' ? JSON.stringify({ id: 'dojo-1', name: 'Alpha Dojo' }) : null),
    );
    authClient.POST.mockImplementation(() => okResponse({}));
    const { result } = await renderAuth();
    await waitFor(() => expect(result.current.pendingSchoolPick).not.toBeNull());

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.pendingSchoolPick).toEqual({ id: 'dojo-1', name: 'Alpha Dojo' });
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith('ultm8.pendingSchoolPick');
  });
});
