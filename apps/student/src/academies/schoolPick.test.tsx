import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

describe('SchoolPickScreen', () => {
  it('defaults to Search mode, and picking a result from the list sets the pending pick', async () => {
    mocked(q.useSchoolSearch).mockReturnValue(ok({ items: [{ id: 'dojo-1', name: 'Downtown Jiu-Jitsu', address: '1 Main St' }], nextCursor: null }));

    const screen = await render(<SchoolPickScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Downtown Jiu-Jitsu'), 'Downtown');
    fireEvent.press(await screen.findByText('Downtown Jiu-Jitsu'));

    expect(setPendingSchoolPick).toHaveBeenCalledWith({ id: 'dojo-1', name: 'Downtown Jiu-Jitsu' });
  });

  it('a search with no matches shows a clear empty state, not a blank screen', async () => {
    mocked(q.useSchoolSearch).mockReturnValue(ok({ items: [], nextCursor: null }));

    const screen = await render(<SchoolPickScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Downtown Jiu-Jitsu'), 'Nonexistent');

    expect(await screen.findByText('No School matched “Nonexistent”.')).toBeTruthy();
    expect(setPendingSchoolPick).not.toHaveBeenCalled();
  });

  it('switching to Join code mode, entering a valid code, and confirming sets the pending pick', async () => {
    mocked(q.useSchoolByJoinCode).mockReturnValue(ok({ id: 'dojo-2', name: 'Uptown Judo', address: null }));

    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    fireEvent.changeText(screen.getByPlaceholderText('e.g. DDZ8KFAA'), 'ddz8kfaa');
    await fireEvent.press(screen.getByText('Find my School'));
    fireEvent.press(await screen.findByText('Uptown Judo'));

    expect(setPendingSchoolPick).toHaveBeenCalledWith({ id: 'dojo-2', name: 'Uptown Judo' });
  });

  it('an unknown join code shows a specific not-found message, not a generic error', async () => {
    mocked(q.useSchoolByJoinCode).mockReturnValue({ data: undefined, isLoading: false, error: new ApiError(404, 'NOT_FOUND', 'Academy not found') } as never);

    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    fireEvent.changeText(screen.getByPlaceholderText('e.g. DDZ8KFAA'), 'ZZZZZZZZ');
    await fireEvent.press(screen.getByText('Find my School'));

    expect(await screen.findByText('No School has that join code — check with your School and try again.')).toBeTruthy();
  });

  it('typed lowercase join-code input is uppercased before it is ever submitted', async () => {
    const screen = await render(<SchoolPickScreen />);
    await fireEvent.press(screen.getByText('Join code'));
    const input = screen.getByPlaceholderText('e.g. DDZ8KFAA');
    fireEvent.changeText(input, 'ddz8kfaa');
    await waitFor(() => expect(input.props.value).toBe('DDZ8KFAA'));
  });
});
