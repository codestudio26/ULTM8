import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as auth from '../auth/AuthContext';
import * as rankQueries from '../ranks/rankQueries';
import * as notificationQueries from '../notifications/notificationQueries';
import * as q from './coachQueries';
import { CoachDashboardScreen } from './CoachDashboardScreen';
import { CoachStudentScreen } from './CoachStudentScreen';
import { GradingBoardScreen } from './GradingBoardScreen';
import { countingClassTypes, flattenLadder } from './ladder';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn(), useCoachSchoolId: jest.fn() }));
jest.mock('../ranks/rankQueries', () => ({ useDisciplines: jest.fn() }));
jest.mock('../notifications/notificationQueries', () => ({ useNotifications: jest.fn() }));
jest.mock('./coachQueries', () => ({
  useMyGrading: jest.fn(),
  useGradingBoard: jest.fn(),
  useSchoolClasses: jest.fn(),
  useSchoolTimetable: jest.fn(),
  useStudentEligibility: jest.fn(),
  useStyleRanks: jest.fn(),
  useStyleSkills: jest.fn(),
  useRankHistory: jest.fn(),
  usePromote: jest.fn(),
  useStripeAward: jest.fn(),
  useDowngrade: jest.fn(),
  useVerifyRank: jest.fn(),
  useCycleSkill: jest.fn(),
  useLogClass: jest.fn(),
}));

// The first render here loads every React Native component these screens use;
// on a busy CI runner that alone has taken over jest's default 5 s.
jest.setTimeout(30_000);

/** Screens read only data/isLoading/error off each query. */
const ok = (data: unknown) => ({ data, isLoading: false, error: null, isError: false }) as never;
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const SCHOOL = 'school-1';
const ME = 'coach-1';
const BJJ = { id: 'bjj', name: 'BJJ', skillsRequiredToGrade: false, classTypesOffered: ['Adult Fundamentals'] };
const JUDO = { id: 'judo', name: 'Judo', skillsRequiredToGrade: false, classTypesOffered: [] };

const tier = (id: string, order: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, order, name, count: order, colour: '#000', eligibleClassTypes: [], bookingUnlocksClassTypes: [], classCountMode: 'ANY_TYPE', classTypeRequirements: [],
  stripeSegments: [], timeOnly: false, requiredSkillIds: [], ...extra,
});
const RANKS = {
  items: [
    { id: 'white', order: 0, name: 'White Belt', primaryColour: '#fff', stripeTiers: [tier('w0', 0, 'White Belt'), tier('w1', 1, 'White Belt · 1 Stripe', { eligibleClassTypes: ['Adult Fundamentals'] })] },
    { id: 'blue', order: 1, name: 'Blue Belt', primaryColour: '#00f', stripeTiers: [tier('b0', 0, 'Blue Belt')] },
  ],
};

function nav() {
  return { navigate: jest.fn() } as never;
}

function grading(perm: Partial<Record<q.GradingToggle, boolean>> = {}, styles = ['bjj']) {
  mocked(q.useMyGrading).mockReturnValue({
    isLoading: false,
    error: null,
    can: (d: string, t: q.GradingToggle) => styles.includes(d) && !!perm[t],
    mayGradeStyle: (d: string) => styles.includes(d),
  });
}

const mutation = () => ({ mutateAsync: jest.fn(async () => ({})), mutate: jest.fn(), isPending: false, isError: false, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useCoachSchoolId).mockReturnValue(SCHOOL);
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: ME, grants: [{ role: 'INSTRUCTOR', schoolId: SCHOOL }] } });
  mocked(rankQueries.useDisciplines).mockReturnValue(ok({ items: [BJJ, JUDO] }));
  mocked(notificationQueries.useNotifications).mockReturnValue(ok({ pages: [{ items: [{ id: 'n1', title: 'Ana is ready to grade', body: 'BJJ', read: false }] }] }));
  mocked(q.useSchoolClasses).mockReturnValue(ok({ items: [] }));
  mocked(q.useSchoolTimetable).mockReturnValue(
    ok({
      items: [
        { id: 's1', instructorId: ME, status: 'ON', weekday: 'TUESDAY', startTime: '18:00', endTime: '19:00', title: 'Fundamentals' },
        { id: 's2', instructorId: 'someone-else', status: 'ON', weekday: 'MONDAY', startTime: '18:00', endTime: '19:00', title: 'Not mine' },
      ],
    }),
  );
  mocked(q.useStyleRanks).mockReturnValue(ok(RANKS));
  mocked(q.useStyleSkills).mockReturnValue(ok({ items: [{ id: 'armbar', name: 'Armbar' }] }));
  mocked(q.useRankHistory).mockReturnValue(ok({ items: [] }));
  for (const fn of [q.usePromote, q.useStripeAward, q.useDowngrade, q.useVerifyRank, q.useCycleSkill, q.useLogClass]) mocked(fn).mockReturnValue(mutation());
});

describe('ladder', () => {
  it('flattens belts then stripes, and finds the class types that count', () => {
    const ladder = flattenLadder(RANKS.items as never);
    expect(ladder.map((r) => r.id)).toEqual(['w0', 'w1', 'b0']);
    expect(countingClassTypes(ladder, ladder[0])).toEqual(['Adult Fundamentals']);
  });
});

describe('CoachDashboardScreen', () => {
  it('shows only the styles the coach grades, their own classes and their notifications', async () => {
    grading({}, ['bjj']);
    mocked(q.useGradingBoard).mockReturnValue(
      ok({ items: [{ eligibility: { boardColumn: 'READY_TO_GRADE' } }, { eligibility: { boardColumn: 'GETTING_THERE' } }, { eligibility: { boardColumn: 'JUST_STARTING' } }] }),
    );
    const { getByText, queryByText } = await render(<CoachDashboardScreen navigation={nav()} route={{} as never} />);
    expect(getByText('BJJ ›')).toBeTruthy();
    expect(queryByText('Judo ›')).toBeNull();
    expect(getByText('1 ready to grade · 1 getting there · 3 students')).toBeTruthy();
    expect(getByText(/Tuesday 18:00–19:00 · Fundamentals/)).toBeTruthy();
    expect(queryByText(/Not mine/)).toBeNull();
    expect(getByText('Ana is ready to grade')).toBeTruthy();
    expect(getByText('See all (1 unread)')).toBeTruthy();
    expect(queryByText('My training')).toBeNull(); // not a student here
  });

  it('opens the Grading Board for a style', async () => {
    grading({}, ['bjj']);
    mocked(q.useGradingBoard).mockReturnValue(ok({ items: [] }));
    const navigation = nav();
    const { getByLabelText } = await render(<CoachDashboardScreen navigation={navigation} route={{} as never} />);
    await fireEvent.press(getByLabelText('Open the Grading Board for BJJ'));
    expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('GradingBoard', { schoolId: SCHOOL, disciplineId: 'bjj', name: 'BJJ' });
  });

  it('says so when they coach nowhere', async () => {
    mocked(auth.useCoachSchoolId).mockReturnValue(null);
    const { getByText } = await render(<CoachDashboardScreen navigation={nav()} route={{} as never} />);
    expect(getByText("You're not a coach at a School yet")).toBeTruthy();
  });
});

describe('GradingBoardScreen', () => {
  it('lists students by column and filters by name', async () => {
    mocked(q.useGradingBoard).mockReturnValue(
      ok({
        hiddenInactive: 2,
        items: [
          { studentId: 'a', firstName: 'Ana', surname: 'Silva', currentStripeId: 'w1', verificationStatus: 'VERIFIED', active: true, eligibility: { boardColumn: 'READY_TO_GRADE', progressPercent: 100 } },
          { studentId: 'b', firstName: 'Ben', surname: 'Costa', currentStripeId: 'w0', verificationStatus: 'UNVERIFIED', active: true, eligibility: { boardColumn: 'JUST_STARTING', progressPercent: 10 } },
        ],
      }),
    );
    const { getByText, queryByText, getByLabelText } = await render(
      <GradingBoardScreen navigation={nav()} route={{ params: { schoolId: SCHOOL, disciplineId: 'bjj', name: 'BJJ' } } as never} />,
    );
    expect(getByText('Ready to Grade (1)')).toBeTruthy();
    expect(getByText('White Belt · 1 Stripe · 100%')).toBeTruthy();
    expect(getByText('White Belt · 10% · Belt not verified')).toBeTruthy();
    expect(getByText('2 inactive hidden')).toBeTruthy();
    await fireEvent.changeText(getByLabelText('Search students'), 'ana');
    expect(queryByText('Ben Costa')).toBeNull();
    expect(getByText('Ana Silva')).toBeTruthy();
  });
});

describe('CoachStudentScreen', () => {
  const route = { params: { schoolId: SCHOOL, disciplineId: 'bjj', studentId: 'a', name: 'Ana Silva', styleName: 'BJJ' } } as never;
  const student = (eligibility: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    mocked(q.useStudentEligibility).mockReturnValue(
      ok({
        items: [
          {
            disciplineId: 'bjj', currentStripeId: 'w0', dateOfCurrentRank: '2026-09-01T12:00:00Z', verificationStatus: 'VERIFIED', skillStatuses: [],
            eligibility: { hasNext: true, nextRungId: 'w1', progressPercent: 80, eligible: true, classesOk: true, daysOk: true, countedClasses: 8, requiredClasses: 10, elapsedDays: 40, requiredDays: 30, requiredSkillIds: [], missingSkillIds: [], ...eligibility },
            ...extra,
          },
        ],
      }),
    );

  it('shows only the actions the coach may take', async () => {
    grading({ canSignOffSkills: true });
    student({});
    const { queryByText } = await render(<CoachStudentScreen navigation={nav()} route={route} />);
    expect(queryByText('Award stripe: White Belt · 1 Stripe')).toBeNull();
    expect(queryByText('Verify belt')).toBeNull();
    expect(queryByText('Log a class')).toBeNull();
  });

  it('awards the next stripe with the stripe the coach saw (Decision 185)', async () => {
    grading({ canPromote: true });
    student({});
    const award = mutation();
    mocked(q.useStripeAward).mockReturnValue(award);
    const { getByText, findByText } = await render(<CoachStudentScreen navigation={nav()} route={route} />);
    await fireEvent.press(getByText('Award stripe: White Belt · 1 Stripe'));
    await fireEvent.press(getByText('Confirm'));
    await findByText('Graded to White Belt · 1 Stripe.');
    expect(award.mutateAsync).toHaveBeenCalledWith({ acknowledgeWithoutSkillSignoff: false, expectedCurrentRungId: 'w0' });
  });

  it('grades into the next belt through promote, and asks for the skills acknowledgement', async () => {
    grading({ canPromote: true });
    mocked(q.useStudentEligibility).mockReset();
    student({ nextRungId: 'b0', missingSkillIds: ['armbar'], requiredSkillIds: ['armbar'], skillsOk: false }, { currentStripeId: 'w1' });
    const promote = mutation();
    mocked(q.usePromote).mockReturnValue(promote);
    const { getByText, getByLabelText, findByText } = await render(<CoachStudentScreen navigation={nav()} route={route} />);
    await fireEvent.press(getByText('Grade to Blue Belt'));
    await fireEvent(getByLabelText('Grade without all skills signed off'), 'valueChange', true);
    await fireEvent.press(getByText('Confirm'));
    await findByText('Graded to Blue Belt.');
    expect(promote.mutateAsync).toHaveBeenCalledWith({ acknowledgeWithoutSkillSignoff: true, expectedCurrentRungId: 'w1', targetRungId: 'b0' });
  });

  it('moves down one stripe only with a reason', async () => {
    grading({ canDowngrade: true });
    student({}, { currentStripeId: 'w1', eligibility: { hasNext: true, nextRungId: 'b0' } });
    const down = mutation();
    mocked(q.useDowngrade).mockReturnValue(down);
    const { getByText, getByLabelText, findByText } = await render(<CoachStudentScreen navigation={nav()} route={route} />);
    await fireEvent.press(getByText('Move down to White Belt'));
    await fireEvent.changeText(getByLabelText('Reason'), 'Missed the basics');
    await fireEvent.press(getByText('Confirm move down'));
    await findByText('Moved down to White Belt.');
    expect(down.mutateAsync).toHaveBeenCalledWith({ acknowledgeWithoutSkillSignoff: false, targetRungId: 'w0', expectedCurrentRungId: 'w1', reason: 'Missed the basics' });
  });

  it('verifies a declared belt', async () => {
    grading({ canVerifyRanks: true });
    student({}, { verificationStatus: 'UNVERIFIED' });
    const verify = mutation();
    mocked(q.useVerifyRank).mockReturnValue(verify);
    const { getByText, findByText } = await render(<CoachStudentScreen navigation={nav()} route={route} />);
    await fireEvent.press(getByText('Verify belt'));
    await findByText('Belt verified.');
    expect(verify.mutateAsync).toHaveBeenCalled();
  });
});
