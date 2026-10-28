import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as bookingQueries from '../bookings/bookingQueries';
import * as waitlistMutations from '../bookings/waitlistMutations';
import * as academyQueries from '../academies/academyQueries';
import { ChildBookingScreen } from './ChildBookingScreen';

jest.mock('../bookings/bookingQueries', () => ({
  useMinorSchools: jest.fn(),
  useMinorBookings: jest.fn(),
  useCancelBooking: jest.fn(),
  useBookClass: jest.fn(),
  useMyFriendPasses: jest.fn(),
  useBookingGuests: jest.fn(),
}));
jest.mock('../bookings/waitlistMutations', () => ({
  useJoinWaitlist: jest.fn(),
  useWithdrawWaitlist: jest.fn(),
}));
jest.mock('../academies/academyQueries', () => ({ useAcademy: jest.fn() }));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const idleMutation = () => ({ mutateAsync: jest.fn<(...args: unknown[]) => Promise<unknown>>(), isPending: false });
const loaded = (data: unknown) => ({ data, isLoading: false, isError: false, error: null });

const route = { key: 'ChildBooking', name: 'ChildBooking' as const, params: { studentId: 'child-1', name: 'Mia' } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderScreen = () => render(<ChildBookingScreen route={route} navigation={{} as any} />);

/** Decision 379 — a parent books a class for their child and manages the child's bookings. */
describe('ChildBookingScreen', () => {
  let cancel: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    cancel = idleMutation();
    mocked(bookingQueries.useCancelBooking).mockReturnValue(cancel);
    mocked(bookingQueries.useBookClass).mockReturnValue(idleMutation());
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({ data: { items: [] } });
    mocked(bookingQueries.useBookingGuests).mockReturnValue({ isLoading: false, error: null, data: { bookingId: 'b1', waiverRequired: true, guests: [] } });
    mocked(waitlistMutations.useJoinWaitlist).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
    mocked(bookingQueries.useMinorSchools).mockReturnValue(
      loaded({ items: [{ schoolId: 's-alpha', name: 'Alpha Gym' }, { schoolId: 's-zebra', name: 'Zebra Dojo' }] }),
    );
    mocked(bookingQueries.useMinorBookings).mockReturnValue(
      loaded({ items: [{ id: 'b1', classId: 'c1', classTitle: 'Kids BJJ', classStartsAt: '2026-11-02T18:00:00.000Z', schoolId: 's-alpha', guestCount: 1 }] }),
    );
    mocked(academyQueries.useAcademy).mockImplementation((id: unknown) =>
      loaded({
        upcomingClasses:
          id === 's-zebra'
            ? [{ id: 'c-zebra', title: 'Zebra Kids', startDate: '2026-11-03T18:00:00.000Z', endDate: '2026-11-03T19:00:00.000Z' }]
            : [{ id: 'c-alpha', title: 'Alpha Kids', startDate: '2026-11-03T18:00:00.000Z', endDate: '2026-11-03T19:00:00.000Z' }],
      }),
    );
  });

  it("lists the child's bookings and cancels one in the child's name", async () => {
    const screen = await renderScreen();
    expect(screen.getByText('Kids BJJ')).toBeTruthy();
    expect(screen.getByText('Guests: 1')).toBeTruthy();
    expect(bookingQueries.useCancelBooking).toHaveBeenCalledWith('child-1');
    expect(bookingQueries.useBookingGuests).toHaveBeenCalledWith('b1', 'child-1');
    await fireEvent.press(screen.getByText('Cancel'));
    await fireEvent.press(screen.getByText('Cancel booking'));
    await waitFor(() => expect(cancel.mutateAsync).toHaveBeenCalledWith('b1'));
  });

  it("shows the first School's classes, and another School's when picked", async () => {
    const screen = await renderScreen();
    expect(screen.getByText('Alpha Kids')).toBeTruthy();
    await fireEvent.press(screen.getByText('Zebra Dojo'));
    expect(screen.getByText('Zebra Kids')).toBeTruthy();
    expect(screen.queryByText('Alpha Kids')).toBeNull();
  });

  it('says so when the child has no School or bookings', async () => {
    mocked(bookingQueries.useMinorSchools).mockReturnValue(loaded({ items: [] }));
    mocked(bookingQueries.useMinorBookings).mockReturnValue(loaded({ items: [] }));
    mocked(academyQueries.useAcademy).mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
    const screen = await renderScreen();
    expect(screen.getByText('Mia has no upcoming bookings.')).toBeTruthy();
    expect(screen.getByText("Mia isn't a student at any School yet.")).toBeTruthy();
  });
});
