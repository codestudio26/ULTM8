import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as bookingQueries from './bookingQueries';
import * as attendanceQueries from '../attendance/attendanceQueries';
import { MyBookingsScreen } from './MyBookingsScreen';

jest.mock('./bookingQueries', () => ({
  useMyBookings: jest.fn(),
  useCancelBooking: jest.fn(),
  useBookingGuests: jest.fn(),
}));
jest.mock('../attendance/attendanceQueries', () => ({
  useEnterCheckInCode: jest.fn(),
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idleMutation = () => ({ mutateAsync: jest.fn<() => Promise<unknown>>(), isPending: false });

function pagedQuery(items: unknown[]) {
  return {
    data: { pages: [{ items }] },
    isLoading: false,
    isError: false,
    error: null,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  };
}

/**
 * Decision 235's camera-free fallback — same house style as
 * payments/paymentMethods.test.tsx: mock every query module entirely, inline
 * fixtures, render + fireEvent, no real react-query/network runtime.
 */
describe('MyBookingsScreen — Decision 235 check-in-with-code', () => {
  let cancelBooking: ReturnType<typeof idleMutation>;
  let enterCode: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    jest.clearAllMocks();
    cancelBooking = idleMutation();
    enterCode = idleMutation();
    mocked(bookingQueries.useCancelBooking).mockReturnValue(cancelBooking);
    mocked(attendanceQueries.useEnterCheckInCode).mockReturnValue(enterCode);
  });

  it('offers "Check in with code" and "Cancel" for an UPCOMING booking', async () => {
    mocked(bookingQueries.useMyBookings).mockReturnValue(
      pagedQuery([{ id: 'b1', classId: 'c1', status: 'UPCOMING', attendees: [] }]),
    );

    const { getByText } = await render(<MyBookingsScreen />);
    expect(getByText('Check in with code')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it('offers neither action for a COMPLETED booking', async () => {
    mocked(bookingQueries.useMyBookings).mockReturnValue(
      pagedQuery([{ id: 'b1', classId: 'c1', status: 'COMPLETED', attendees: [] }]),
    );

    const { queryByText } = await render(<MyBookingsScreen />);
    expect(queryByText('Check in with code')).toBeNull();
    expect(queryByText('Cancel')).toBeNull();
  });

  it('tapping "Check in with code" opens the code field; submits classId + code on Check in', async () => {
    mocked(bookingQueries.useMyBookings).mockReturnValue(
      pagedQuery([{ id: 'b1', classId: 'c1', status: 'UPCOMING', attendees: [] }]),
    );

    const { getByText, getByPlaceholderText } = await render(<MyBookingsScreen />);
    await fireEvent.press(getByText('Check in with code'));

    const input = getByPlaceholderText('123456');
    await fireEvent.changeText(input, '482913');
    await fireEvent.press(getByText('Check in'));

    await waitFor(() => expect(enterCode.mutateAsync).toHaveBeenCalledWith({ classId: 'c1', code: '482913' }));
  });

  it('shows the API error message inline when the code is rejected', async () => {
    mocked(bookingQueries.useMyBookings).mockReturnValue(
      pagedQuery([{ id: 'b1', classId: 'c1', status: 'UPCOMING', attendees: [] }]),
    );
    enterCode.mutateAsync.mockRejectedValueOnce(new Error('boom'));

    const { getByText, getByPlaceholderText } = await render(<MyBookingsScreen />);
    await fireEvent.press(getByText('Check in with code'));
    await fireEvent.changeText(getByPlaceholderText('123456'), '482913');
    await fireEvent.press(getByText('Check in'));

    await waitFor(() => expect(getByText('Incorrect or expired code — ask Staff for the current code.')).toBeTruthy());
  });
  it("lists an upcoming booking's guests with each one's link and whether they signed", async () => {
    mocked(bookingQueries.useMyBookings).mockReturnValue(pagedQuery([{ id: 'b1', classId: 'c1', status: 'UPCOMING', attendees: [{ id: 'a1' }, { id: 'a2' }] }]));
    mocked(bookingQueries.useBookingGuests).mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        bookingId: 'b1',
        waiverRequired: true,
        guests: [
          { attendeeId: 'a1', link: 'https://portal.example/guest-waiver/tok1', waiverStatus: 'UNSIGNED', guestFullName: null },
          { attendeeId: 'a2', link: 'https://portal.example/guest-waiver/tok2', waiverStatus: 'SIGNED', guestFullName: 'Gina Guest' },
        ],
      },
    });
    const { getByText, queryByText } = await render(<MyBookingsScreen />);
    expect(getByText('Guest 1')).toBeTruthy();
    expect(getByText("Hasn't signed the waiver yet")).toBeTruthy();
    expect(getByText('https://portal.example/guest-waiver/tok1')).toBeTruthy();
    expect(getByText('Waiver signed: Gina Guest')).toBeTruthy();
    expect(queryByText('https://portal.example/guest-waiver/tok2')).toBeNull();
    expect(mocked(bookingQueries.useBookingGuests)).toHaveBeenCalledWith('b1');
  });
});
