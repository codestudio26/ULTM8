import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import * as q from './rankQueries';
import { MyRankSection } from './MyRankSection';

jest.mock('./rankQueries', () => ({ useRank: jest.fn() }));

// The first render loads every React Native component this section uses.
jest.setTimeout(30_000);

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null }) as never;
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const BLUE = {
  id: 'blue', order: 13, name: 'Blue Belt', primaryColour: '#00f', secondaryColour: null, rankDisplay: 'BELTS',
  stripeTiers: [
    { id: 'b0', order: 0, count: 0, name: 'Blue Belt' },
    { id: 'b3', order: 3, count: 3, name: 'Blue Belt · 3 Stripes' },
  ],
};
const disciplines = ok({ items: [{ id: 'bjj', name: 'BJJ' }] });
const ranks = (currentStripeId: string | null) => ok({ items: [{ id: 'sr1', disciplineId: 'bjj', currentRankId: 'blue', currentStripeId }] });

describe('MyRankSection (the School page in the member app)', () => {
  it("shows the belt's name and stripes as the School named the rung, never the ladder position", async () => {
    mocked(q.useRank).mockReturnValue(ok(BLUE));
    const { getByText, queryByText } = await render(<MyRankSection studentRanks={ranks('b3')} disciplines={disciplines} />);
    expect(getByText('BJJ')).toBeTruthy();
    expect(getByText('Blue Belt · 3 Stripes')).toBeTruthy();
    expect(queryByText(/Rank 13/)).toBeNull();
  });

  it("no stripe rung on record: the belt's own name", async () => {
    mocked(q.useRank).mockReturnValue(ok(BLUE));
    const { getByText } = await render(<MyRankSection studentRanks={ranks(null)} disciplines={disciplines} />);
    expect(getByText('Blue Belt')).toBeTruthy();
  });
});
