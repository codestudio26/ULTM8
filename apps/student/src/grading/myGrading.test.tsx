import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as q from './myGradingQueries';
import { MyGradingScreen } from './MyGradingScreen';
import { GradingHistoryScreen } from './GradingHistoryScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('./myGradingQueries', () => ({ useGradingOverview: jest.fn(), useMyRankHistory: jest.fn(), useMyFeeRequests: jest.fn(), useAnswerFee: jest.fn() }));

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

const answer = { mutate: jest.fn(), isPending: false, error: null };
const FEE = {
  id: 'fee1', schoolId: 'alpha', schoolName: 'Alpha Dojo', studentId: 'me', disciplineId: 'bjj', disciplineName: 'BJJ',
  toRungId: 'w1', toRungName: 'White Belt · 1 Stripe', expectedCurrentRungId: 'w0', amountMinor: 6000, currency: 'BRL',
  status: 'PENDING', promotionWaits: true, promotionApplied: false, gradingDate: '2026-10-18', toDecide: false, createdAt: '2026-10-18T12:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] } });
  mocked(q.useGradingOverview).mockReturnValue(ok({ items: [BJJ, JUDO] }));
  mocked(q.useMyFeeRequests).mockReturnValue(ok({ items: [] }));
  mocked(q.useAnswerFee).mockReturnValue(answer);
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

describe('progress breakdown and hours trained', () => {
  it('shows each requirement, what is in the %, and hours as a record only', async () => {
    const item = {
      ...BJJ,
      eligibility: { ...BJJ.eligibility, progressPercent: 75, eligible: false },
      progressBreakdown: {
        classes: { counted: 30, required: 40, percent: 75, byType: [] },
        days: { elapsed: 20, required: 30, percent: 67 },
        skills: { signedOff: 1, required: 2, percent: 50 },
      },
      hoursTrained: { totalMinutes: 3700, sinceCurrentRankMinutes: 90 },
    };
    mocked(q.useGradingOverview).mockReturnValue(ok({ items: [item] }));
    const { getByText, getByLabelText } = await render(<MyGradingScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('· Classes: 30 of 40 · 75% · counts toward the %')).toBeTruthy();
    expect(getByText(/Days at this rank: 20 of 30 · 67% · needed too, not in the %/)).toBeTruthy();
    expect(getByText('· Skills signed off: 1 of 2 · 50% · needed too, not in the %')).toBeTruthy();
    expect(getByText('The % is classes out of classes required.')).toBeTruthy();
    expect(getByLabelText('Hours trained')).toBeTruthy();
    expect(getByText('1.5 h at this rank · 61.7 h in all')).toBeTruthy();
    expect(getByText("A record of your time on the mat. Grading doesn't use it.")).toBeTruthy();
  });
});

describe('promotion fee', () => {
  it('shows the fee, then Accept sends the answer', async () => {
    mocked(q.useMyFeeRequests).mockReturnValue(ok({ items: [FEE] }));
    const { getByText, queryByText } = await render(<MyGradingScreen navigation={nav()} route={{ params: undefined } as never} />);
    expect(getByText('You were graded to White Belt · 1 Stripe')).toBeTruthy();
    expect(queryByText(/Nothing is charged until you accept it/)).toBeNull();
    await fireEvent.press(getByText('See and answer'));
    expect(getByText(/Nothing is charged until you accept it\. Your promotion goes through once the fee is accepted and paid\./)).toBeTruthy();
    await fireEvent.press(getByText(/^Accept /));
    expect(answer.mutate).toHaveBeenCalledWith({ id: 'fee1', answer: 'accept' }, expect.anything());
  });

  it('Decline asks again, in red, before sending', async () => {
    mocked(q.useMyFeeRequests).mockReturnValue(ok({ items: [FEE] }));
    const { getByText } = await render(<MyGradingScreen navigation={nav()} route={{ params: undefined } as never} />);
    await fireEvent.press(getByText('See and answer'));
    await fireEvent.press(getByText('Decline'));
    expect(answer.mutate).not.toHaveBeenCalled();
    expect(getByText(/The School is told, and the promotion to White Belt · 1 Stripe doesn't go ahead\./)).toBeTruthy();
    await fireEvent.press(getByText('Yes, decline'));
    expect(answer.mutate).toHaveBeenCalledWith({ id: 'fee1', answer: 'decline' }, expect.anything());
  });

  it('a guardian answers for their child; an accepted fee waits for payment; settled ones are not shown', async () => {
    mocked(q.useMyFeeRequests).mockReturnValue(
      ok({ items: [FEE, { ...FEE, id: 'fee2', status: 'ACCEPTED', toRungName: 'Blue Belt' }, { ...FEE, id: 'fee3', status: 'PAID', toRungName: 'Purple Belt' }] }),
    );
    const { getByText, queryByText } = await render(<MyGradingScreen navigation={nav()} route={{ params: { studentId: 'kid', name: 'Ben' } } as never} />);
    expect(mocked(q.useMyFeeRequests)).toHaveBeenCalledWith('kid');
    expect(getByText('Ben was graded to White Belt · 1 Stripe')).toBeTruthy();
    expect(getByText(/You accepted the fee\. The promotion to Blue Belt goes through once it is paid\./)).toBeTruthy();
    expect(queryByText(/Purple Belt/)).toBeNull();
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
