import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ChildInvites } from './ChildInvites';

jest.mock('../api', () => ({
  apiClient: { GET: jest.fn(), POST: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { apiClient } = require('../api') as { apiClient: { GET: ReturnType<typeof jest.fn>; POST: ReturnType<typeof jest.fn> } };

jest.setTimeout(30_000);

const ok = <T,>(data: T) => Promise.resolve({ data, response: { ok: true, status: 200 } as Response });
const INVITE = { id: 'inv1', schoolId: 's1', schoolName: 'Alpha Dojo', childFirstName: 'Kit', childSurname: 'Young', childDateOfBirth: '2016-03-04', guardianName: null, guardianEmail: null, createdAt: '2026-10-29T00:00:00Z' };

let client: QueryClient | undefined;
afterEach(() => {
  client?.clear();
  jest.clearAllMocks();
});

async function renderInvites() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChildInvites />
    </QueryClientProvider>,
  );
}

describe('ChildInvites (Decision 403)', () => {
  it('shows "Add {child} to {School}?" and accepts it', async () => {
    (apiClient.GET as jest.Mock).mockImplementation(() => ok({ items: [INVITE] }) as never);
    (apiClient.POST as jest.Mock).mockImplementation(() => ok({ schoolId: 's1', studentId: 'kid' }) as never);
    const screen = await renderInvites();
    await waitFor(() => expect(screen.getByText('Add Kit Young to Alpha Dojo?')).toBeTruthy());
    fireEvent.press(screen.getByText('Accept'));
    await waitFor(() => expect(apiClient.POST).toHaveBeenCalledWith('/v1/child-invites/{id}/accept', { params: { path: { id: 'inv1' } } }));
  });

  it('declines', async () => {
    (apiClient.GET as jest.Mock).mockImplementation(() => ok({ items: [INVITE] }) as never);
    (apiClient.POST as jest.Mock).mockImplementation(() => ok(undefined) as never);
    const screen = await renderInvites();
    await waitFor(() => expect(screen.getByText('No thanks')).toBeTruthy());
    fireEvent.press(screen.getByText('No thanks'));
    await waitFor(() => expect(apiClient.POST).toHaveBeenCalledWith('/v1/child-invites/{id}/decline', { params: { path: { id: 'inv1' } } }));
  });

  it('shows nothing without invites', async () => {
    (apiClient.GET as jest.Mock).mockImplementation(() => ok({ items: [] }) as never);
    const screen = await renderInvites();
    await waitFor(() => expect(apiClient.GET).toHaveBeenCalled());
    expect(screen.queryByText(/Add Kit Young/)).toBeNull();
  });
});
