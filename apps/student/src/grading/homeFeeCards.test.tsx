import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeFeeCards } from './HomeFeeCards';

jest.mock('./myGradingQueries', () => {
  const actual = jest.requireActual('./myGradingQueries') as typeof import('./myGradingQueries');
  return {
    ...actual,
    // Each person's fee requests come from this table instead of the API.
    feeRequestsQuery: (studentId: string | null) => ({
      queryKey: ['my-fee-requests', studentId],
      queryFn: async () => ({ items: (mockFees as Record<string, unknown[]>)[studentId ?? ''] ?? [] }),
      enabled: !!studentId,
    }),
  };
});

jest.setTimeout(30_000);

const fee = (id: string, extra: Record<string, unknown> = {}) => ({
  id, schoolId: 's', schoolName: 'Alpha Dojo', studentId: 'x', disciplineId: 'bjj', disciplineName: 'BJJ',
  toRungId: 'p', toRungName: 'Purple Belt', amountMinor: 6000, currency: 'GBP',
  status: 'PENDING', promotionWaits: true, promotionApplied: false, toDecide: false, createdAt: '2026-10-18T12:00:00Z', ...extra,
});

const mockFees = {
  me: [fee('mine'), fee('accepted', { status: 'ACCEPTED', toRungName: 'Blue Belt' }), fee('decide', { toDecide: true, toRungName: 'Brown Belt' })],
  kid: [fee('kids', { toRungName: 'Grey Belt' })],
};

async function renderCards(onAnswer = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = await render(
    <QueryClientProvider client={client}>
      <HomeFeeCards
        people={[
          { studentId: 'me', childName: null },
          { studentId: 'kid', childName: 'Ben' },
        ]}
        onAnswer={onAnswer}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onAnswer };
}

describe('HomeFeeCards', () => {
  it('shows a card for each fee waiting for an answer, the student\'s and their child\'s', async () => {
    const { findByText, queryByText } = await renderCards();
    expect(await findByText('You were graded to Purple Belt')).toBeTruthy();
    expect(await findByText('Ben was graded to Grey Belt')).toBeTruthy();
    // Already answered, or left to a coach: nothing to answer from Home.
    expect(queryByText(/Blue Belt/)).toBeNull();
    expect(queryByText(/Brown Belt/)).toBeNull();
  });

  it('See and answer passes the person and the fee', async () => {
    const { findAllByText, onAnswer } = await renderCards();
    const buttons = await findAllByText('See and answer');
    await fireEvent.press(buttons[1]);
    expect(onAnswer).toHaveBeenCalledWith({ studentId: 'kid', childName: 'Ben' }, expect.objectContaining({ id: 'kids' }));
  });

  it('shows nothing when no fee is waiting', async () => {
    const client = new QueryClient();
    const { toJSON } = await render(
      <QueryClientProvider client={client}>
        <HomeFeeCards people={[]} onAnswer={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(toJSON()).toBeNull();
  });
});
