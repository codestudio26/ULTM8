import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as q from './myGradingQueries';
import { MyGradingScreen } from './MyGradingScreen';
import { GradingHistoryScreen } from './GradingHistoryScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('./myGradingQueries', () => ({ useGradingOverview: jest.fn(), useMyRankHistory: jest.fn() }));

// The first render loads every React Native component these screens use; on a
// busy CI runner that alone can pass jest's default 5 s.
jest.setTimeout(30_000);

const ok = (data: unknown) => ({ data, isLoading: false, error: null }) as never;
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const rung = (id: string, name: string, beltName: string, extra: Record<string, unknown> = {}) => ({
  id, name, beltName, primaryColour: '#fff', secondaryColour: null, stripeColour: '#000', stripeCount: 0, timeOnly: false, ...extra,
});
const BJJ = {
  schoolId: 'alpha', schoolName: 'Alpha Dojo', disciplineId: 'bjj', disciplineName: 'BJJ', currentStripeId: 'w0', dateOfCurrentRank: '2026-09-01T12:00:00Z',
  verificationStatus: 'VERIFIED',
  ladder: [rung('w0', 'White Belt', 'White Belt'), rung('w1', 'White Belt · 1 Stripe', 'White Belt'), rung('b0', 'Blue Belt', 'Blue Belt')],
  eligibility: { hasNext: true, nextRungId: 'w1', progressPercent: 100, eligible: true, classesOk: true, daysOk: true, countedClasses: 10, requiredClasses: 10, elapsedDays: 40, requiredDays: 30 },
  skills: [{ id: 'armbar', name: 'Armbar', status: 'SIGNED_OFF', required: true }],
};
const JUDO = {
  ...BJJ, schoolId: 'beta', schoolName: 'Beta Dojo', disciplineId: 'judo', disciplineName: 'Judo', currentStripeId: 'y0', verificationStatus: 'UNVERIFIED',
  ladder: [rung('y0', 'Yellow Belt', 'Yellow Belt')], eligibility: { hasNext: false }, skills: [],
};

function nav() {
  return { navigate: jest.fn() } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] } });
  mocked(q.useGradingOverview).mockReturnValue(ok({ items: [BJJ, JUDO] }));
});

describe('MyGradingScreen', () => {
  it('shows each style with its stripe, progress, readiness and skills, read-only', async () => {
    const { getByText, getByLabelText, queryByRole } = await render(<MyGradingScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(mocked(q.useGradingOverview)).toHaveBeenCalledWith('me');
    expect(getByText('BJJ')).toBeTruthy();
    expect(getByText('Alpha Dojo')).toBeTruthy();
    expect(getByText('White Belt')).toBeTruthy();
    expect(getByText('Next: White Belt · 1 Stripe')).toBeTruthy();
    expect(getByText('100% of the way')).toBeTruthy();
    expect(getByLabelText('Ready to grade')).toBeTruthy(); // Decision 161: always shown
    expect(getByLabelText('Armbar: Signed off')).toBeTruthy();
    expect(getByText('Top of the ladder.')).toBeTruthy();
    expect(getByText('Waiting for the School to verify this belt.')).toBeTruthy();
    expect(queryByRole('switch')).toBeNull();
  });

  it('a guardian opens it for their child', async () => {
    await render(<MyGradingScreen navigation={nav()} route={{ params: { studentId: 'kid', name: 'Kai' } } as never} />);
    expect(mocked(q.useGradingOverview)).toHaveBeenCalledWith('kid');
  });

  it('opens the history for a School', async () => {
    const navigation = nav();
    const { getAllByText } = await render(<MyGradingScreen navigation={navigation} route={{ params: undefined } as never} />);
    await fireEvent.press(getAllByText('History')[0]);
    expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('GradingHistory', { studentId: 'me', schoolId: 'alpha', title: 'BJJ history' });
  });

  it('says so when there is no rank yet', async () => {
    mocked(q.useGradingOverview).mockReturnValue(ok({ items: [] }));
    const { getByText } = await render(<MyGradingScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText(/No rank yet/)).toBeTruthy();
  });
});

describe('GradingHistoryScreen', () => {
  it('lists the history newest first with stripe names', async () => {
    mocked(q.useMyRankHistory).mockReturnValue(
      ok({
        items: [
          { id: 'e2', type: 'STRIPE_AWARD', toStripeTierId: 'w1', effectiveDate: '2026-10-01T12:00:00Z', reason: null, note: 'Great guard' },
          { id: 'e1', type: 'DOWNGRADE', toStripeTierId: 'w0', effectiveDate: '2026-09-01T12:00:00Z', reason: 'Missed basics', note: null },
        ],
      }),
    );
    const { getByText } = await render(<GradingHistoryScreen navigation={nav()} route={{ params: { studentId: 'me', schoolId: 'alpha', title: 'BJJ history' } } as never} />);
    expect(getByText('Stripe awarded: White Belt · 1 Stripe')).toBeTruthy();
    expect(getByText('Great guard')).toBeTruthy();
    expect(getByText('Moved down: White Belt')).toBeTruthy();
    expect(getByText('Reason: Missed basics')).toBeTruthy();
  });
});
