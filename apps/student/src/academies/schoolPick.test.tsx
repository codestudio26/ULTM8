import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as auth from '../auth/AuthContext';
import * as q from './publicSchoolQueries';
import { SchoolPickScreen } from './SchoolPickScreen';

// Decision 266 — the pre-auth School-pick screen (search + join-code modes).
// Same house style as joinSchool.test.tsx: mocked AuthContext/query modules,
// inline fixtures, getByText/fireEvent — no real navigation or network.
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('./publicSchoolQueries', () => ({ useSchoolSearch: jest.fn(), useSchoolByJoinCode: jest.fn() }));

const ok = (data: unknown) => ({ data, isLoading: false, isFetching: false, error: null }) as never;
const empty = () => ({ data: undefined, isLoading: false, isFetching: false, error: null }) as never;
const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const setPendingSchoolPick = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mocked(auth.useAuth).mockReturnValue({ setPendingSchoolPick });
  mocked(q.useSchoolSearch).mockReturnValue(empty());
  mocked(q.useSchoolByJoinCode).mockReturnValue(empty());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SchoolPickScreen', () => {
  // The two search tests use fake timers (scoped to just these, not the
  // whole file — react-query's own internals also use timers, and faking
  // them globally risks unrelated side effects) to deterministically flush
  // SearchMode's 350ms debounce without a real wait or an act() warning.
  it('defaults to Search mode, and picking a result from the list sets the pending pick', async () => {
    jest.useFakeTimers();
    mocked(q.useSchoolSearch).mockReturnValue(ok({ items: [{ id: 'dojo-1', name: 'Downtown Jiu-Jitsu', address: '1 Main St' }], nextCursor: null }));

    const screen = await render(<SchoolPickScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Downtown Jiu-Jitsu'), 'Downtown');
    act(() => jest.advanceTimersByTime(350));
    jest.useRealTimers();
    fireEvent.press(await screen.findByText('Downtown Jiu-Jitsu'));

    expect(setPendingSchoolPick).toHaveBeenCalledWith({ id: 'dojo-1', name: 'Downtown Jiu-Jitsu' });
  });

  it('a search with no matches shows a clear empty state, not a blank screen', async () => {
    jest.useFakeTimers();
    mocked(q.useSchoolSearch).mockReturnValue(ok({ items: [], nextCursor: null }));

    const screen = await render(<SchoolPickScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Downtown Jiu-Jitsu'), 'Nonexistent');
    act(() => jest.advanceTimersByTime(350));
    jest.useRealTimers();

    expect(await screen.findByText('No School matched “Nonexistent”.')).toBeTruthy();
    expect(setPendingSchoolPick).not.toHaveBeenCalled();
  });

  it('switching to Join code mode, entering a valid code, and confirming sets the pending pick', async () => {
    mocked(q.useSchoolByJoinCode).mockReturnValue(ok({ id: 'dojo-2', name: 'Uptown Judo', address: null }));

    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. DDZ8KFAA'), 'ddz8kfaa');
    await fireEvent.press(screen.getByText('Find my School'));
    fireEvent.press(await screen.findByText('Uptown Judo'));

    expect(setPendingSchoolPick).toHaveBeenCalledWith({ id: 'dojo-2', name: 'Uptown Judo' });
  });

  it('an unknown join code shows a specific not-found message, not a generic error', async () => {
    mocked(q.useSchoolByJoinCode).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError(404, 'NOT_FOUND', 'Academy not found') } as never);

    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. DDZ8KFAA'), 'ZZZZZZZZ');
    await fireEvent.press(screen.getByText('Find my School'));

    expect(await screen.findByText('No School has that join code — check with your School and try again.')).toBeTruthy();
  });

  it("search doesn't query with the typed text before the debounce window elapses", async () => {
    jest.useFakeTimers();
    mocked(q.useSchoolSearch).mockReturnValue(empty());

    const screen = await render(<SchoolPickScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Downtown Jiu-Jitsu'), 'Downtown');
    // Short of the 350ms debounce — the hook must still be called with the
    // empty string, proving the query hasn't fired with the typed text yet.
    act(() => jest.advanceTimersByTime(200));
    jest.useRealTimers();
    expect(mocked(q.useSchoolSearch)).toHaveBeenLastCalledWith('');
  });

  it('editing the code after a successful lookup hides the previous result until re-submitted, so a stale School can never be picked', async () => {
    mocked(q.useSchoolByJoinCode).mockReturnValue(ok({ id: 'dojo-2', name: 'Uptown Judo', address: null }));

    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. DDZ8KFAA'), 'AAAAAAAA');
    await fireEvent.press(screen.getByText('Find my School'));
    expect(await screen.findByText('Uptown Judo')).toBeTruthy();

    // Edit the field WITHOUT re-submitting — the hook mock still "returns"
    // Uptown Judo (nothing re-fetched in this test), but the result must
    // disappear anyway: it no longer matches what's actually typed.
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. DDZ8KFAA'), 'BBBBBBBB');
    await waitFor(() => expect(screen.queryByText('Uptown Judo')).toBeNull());
  });

  it('typed lowercase join-code input is uppercased before it is ever submitted', async () => {
    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    const input = screen.getByPlaceholderText('e.g. DDZ8KFAA');
    fireEvent.changeText(input, 'ddz8kfaa');
    await waitFor(() => expect(input.props.value).toBe('DDZ8KFAA'));
  });
});
