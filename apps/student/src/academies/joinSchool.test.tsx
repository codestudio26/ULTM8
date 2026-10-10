import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as auth from '../auth/AuthContext';
import * as guardians from '../guardians/guardianQueries';
import * as academies from './academyQueries';
import * as q from './joinQueries';
import { JoinSchoolScreen } from './JoinSchoolScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn(), useEnrolledSchoolIds: jest.fn(), useIsGuardian: jest.fn() }));
jest.mock('../guardians/guardianQueries', () => ({ useMyMinors: jest.fn() }));
jest.mock('./academyQueries', () => ({ useAcademy: jest.fn() }));
jest.mock('./joinQueries', () => ({ useJoinSchool: jest.fn(), useDeclareOptions: jest.fn(), useDeclareBelt: jest.fn() }));

// The first render loads every React Native component these screens use; on a
// busy CI runner that alone can pass jest's default 5 s.
jest.setTimeout(30_000);

const ok = (data: unknown) => ({ data, isLoading: false, error: null }) as never;
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const rung = (id: string, rankId: string, name: string) => ({
  id, rankId, name, beltName: name.split(' ·')[0], primaryColour: '#fff', secondaryColour: null, stripeColour: '#000', stripeCount: 0, timeOnly: false,
});
const STYLES = [
  { disciplineId: 'bjj', disciplineName: 'BJJ', ladder: [rung('w0', 'white', 'White'), rung('w1', 'white', 'White · 1 Stripe'), rung('b0', 'blue', 'Blue')] },
  { disciplineId: 'judo', disciplineName: 'Judo', ladder: [rung('y0', 'yellow', 'Yellow')] },
];

const join = jest.fn<(v: unknown) => Promise<unknown>>();
const declare = jest.fn<(v: unknown) => Promise<unknown>>();
const applyAccessToken = jest.fn<(t: string) => Promise<void>>();

function nav() {
  return { navigate: jest.fn(), goBack: jest.fn() } as never;
}
const route = (params: Record<string, unknown> = {}) => ({ params: { academyId: 'dojo', name: 'Alpha Dojo', ...params } }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ claims: { sub: 'me', grants: [] }, applyAccessToken });
  mocked(auth.useEnrolledSchoolIds).mockReturnValue([]);
  mocked(auth.useIsGuardian).mockReturnValue(false);
  mocked(guardians.useMyMinors).mockReturnValue(ok(undefined));
  mocked(academies.useAcademy).mockReturnValue(ok({ id: 'dojo', name: 'Alpha Dojo', branches: [{ id: 'north', name: 'North' }, { id: 'south', name: 'South' }] }));
  join.mockResolvedValue({ id: 'grant', accessToken: 'new-token' });
  declare.mockResolvedValue({});
  applyAccessToken.mockResolvedValue();
  mocked(q.useJoinSchool).mockReturnValue({ mutateAsync: join, isPending: false, isError: false, error: null });
  mocked(q.useDeclareBelt).mockReturnValue({ mutateAsync: declare, isPending: false });
  mocked(q.useDeclareOptions).mockReturnValue(ok({ items: STYLES }));
});

describe('JoinSchoolScreen', () => {
  it('a student picks a home branch, joins, then declares a belt in the styles they train', async () => {
    const navigation = nav();
    const screen = await render(<JoinSchoolScreen navigation={navigation} route={route()} />);

    // Join needs both who and a branch.
    await fireEvent.press(screen.getByText('Join'));
    expect(join).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Me'));
    await fireEvent.press(screen.getByLabelText('South'));
    await fireEvent.press(screen.getByText('Join'));
    expect(join).toHaveBeenCalledWith({ schoolId: 'dojo', studentId: undefined, branchId: 'south' });
    expect(applyAccessToken).toHaveBeenCalledWith('new-token');

    // The belts: one style chosen, the other left on "I don't train this".
    expect(await screen.findByText('Your current belt')).toBeTruthy();
    expect(mocked(q.useDeclareOptions)).toHaveBeenCalledWith('me', 'dojo');
    expect(screen.getAllByLabelText("I don't train this")).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('White · 1 Stripe'));
    await fireEvent.press(screen.getByText('Save'));
    expect(declare).toHaveBeenCalledTimes(1);
    expect(declare).toHaveBeenCalledWith({ studentId: 'me', disciplineId: 'bjj', rankId: 'white', stripeTierId: 'w1' });
    expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('MyGrading', undefined);
  });

  it('a School with no branches asks for none', async () => {
    mocked(academies.useAcademy).mockReturnValue(ok({ id: 'dojo', name: 'Alpha Dojo', branches: [] }));
    const screen = await render(<JoinSchoolScreen navigation={nav()} route={route()} />);
    expect(screen.queryByText('Home branch')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Me'));
    await fireEvent.press(screen.getByText('Join'));
    expect(join).toHaveBeenCalledWith({ schoolId: 'dojo', studentId: undefined, branchId: undefined });
  });

  it('a guardian joins their child; a child already at the School can still add a belt', async () => {
    mocked(auth.useEnrolledSchoolIds).mockReturnValue(['dojo']); // the guardian is a student here already
    mocked(auth.useIsGuardian).mockReturnValue(true);
    mocked(guardians.useMyMinors).mockReturnValue(ok({ items: [{ studentId: 'kid', firstName: 'Kai', surname: 'Lee' }] }));
    join.mockRejectedValue(new ApiError(409, 'CONFLICT', 'This Student is already enrolled at this School.'));
    const navigation = nav();
    const screen = await render(<JoinSchoolScreen navigation={navigation} route={route()} />);

    expect(screen.queryByLabelText('Me')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Kai Lee'));
    await fireEvent.press(screen.getByLabelText('North'));
    await fireEvent.press(screen.getByText('Join'));
    expect(join).toHaveBeenCalledWith({ schoolId: 'dojo', studentId: 'kid', branchId: 'north' });
    expect(applyAccessToken).not.toHaveBeenCalled();

    expect(await screen.findByText("Kai Lee's current belt")).toBeTruthy();
    expect(screen.getByText('Kai Lee is already a student here.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Yellow'));
    await fireEvent.press(screen.getByText('Save'));
    expect(declare).toHaveBeenCalledWith({ studentId: 'kid', disciplineId: 'judo', rankId: 'yellow', stripeTierId: 'y0' });
    expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('MyGrading', { studentId: 'kid', name: 'Kai Lee' });
  });

  it('opened to add a belt later, it goes straight to the belts; with nothing to add it says so', async () => {
    mocked(q.useDeclareOptions).mockReturnValue(ok({ items: [] }));
    const screen = await render(<JoinSchoolScreen navigation={nav()} route={route({ beltsFor: { studentId: 'me', name: 'Me' } })} />);
    expect(screen.getByText('Your current belt')).toBeTruthy();
    expect(screen.getByText(/Nothing to add here/)).toBeTruthy();
    expect(join).not.toHaveBeenCalled();
  });

  it('a belt that fails to save is reported and the screen stays open', async () => {
    declare.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'This School has ranks disabled.'));
    const navigation = nav();
    const screen = await render(<JoinSchoolScreen navigation={navigation} route={route({ beltsFor: { studentId: 'me', name: 'Me' } })} />);
    await fireEvent.press(screen.getByLabelText('Blue'));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText('This School has ranks disabled.')).toBeTruthy();
    expect((navigation as { navigate: jest.Mock }).navigate).not.toHaveBeenCalled();
  });
});
