import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useMyQrToken } from './attendanceQueries';

jest.mock('../api', () => ({
  apiClient: { GET: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { GET: ReturnType<typeof jest.fn> } };

// Tracked so afterEach can tear it down — an un-cleared QueryClient leaves its
// internal gc timer running past the end of the test, which is what was making
// the jest worker hang around after the suite finished.
let activeQueryClient: QueryClient | undefined;

async function renderWithClient(enabled: boolean) {
  const queryClient = new QueryClient();
  activeQueryClient = queryClient;
  return renderHook(() => useMyQrToken(enabled), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

function okResponse<T>(data: T) {
  return Promise.resolve({ data, response: { ok: true, status: 200 } as Response });
}

describe('useMyQrToken', () => {
  beforeEach(() => {
    apiClient.GET.mockReset();
  });

  afterEach(() => {
    activeQueryClient?.clear();
    activeQueryClient = undefined;
  });

  it('does not fetch when disabled', async () => {
    await renderWithClient(false);
    expect(apiClient.GET).not.toHaveBeenCalled();
  });

  it('fetches the current token and exposes it as data', async () => {
    const expiresAt = new Date(Date.now() + 20_000).toISOString();
    apiClient.GET.mockReturnValueOnce(okResponse({ token: 'abc123', expiresAt }));

    const { result } = await renderWithClient(true);

    await waitFor(() => expect(result.current.data).toEqual({ token: 'abc123', expiresAt }));
    expect(apiClient.GET).toHaveBeenCalledWith('/v1/attendance/my-qr-token', {});
  });

  it('refetches a fresh token shortly before the current one expires', async () => {
    jest.useFakeTimers();
    const firstExpiresAt = new Date(Date.now() + 5_000).toISOString();
    const secondExpiresAt = new Date(Date.now() + 25_000).toISOString();
    apiClient.GET.mockReturnValueOnce(okResponse({ token: 'first', expiresAt: firstExpiresAt }));
    apiClient.GET.mockReturnValueOnce(okResponse({ token: 'second', expiresAt: secondExpiresAt }));

    const { result } = await renderWithClient(true);
    await waitFor(() => expect(result.current.data?.token).toBe('first'));

    // The hook schedules its refetch 2s before expiry (msUntilExpiry - 2_000), so a
    // token good for 5 more seconds should refetch at ~3s, well before it expires.
    jest.advanceTimersByTime(3_500);
    await waitFor(() => expect(result.current.data?.token).toBe('second'));

    jest.useRealTimers();
  });
});
