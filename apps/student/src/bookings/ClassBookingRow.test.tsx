import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@ultm8/api-client';
import * as bookingQueries from './bookingQueries';
import * as waitlistMutations from './waitlistMutations';
import { ClassBookingRow } from './ClassBookingRow';

jest.mock('./bookingQueries', () => ({
  useBookClass: jest.fn(),
  useMyFriendPasses: jest.fn(),
  useBookingGuests: jest.fn(),
  useMyBookings: jest.fn(() => ({ data: { pages: [{ items: [] }] } })),
}));
jest.mock('./waitlistMutations', () => ({
  useJoinWaitlist: jest.fn(),
  useWithdrawWaitlist: jest.fn(),
  useMyWaitlist: jest.fn(() => ({ data: { items: [] } })),
}));

jest.mock('./ClassTicketOffer', () => {
  const { Text } = require('react-native');
  return { ClassTicketOffer: (p: { classId: string; studentId?: string }) => <Text>{`ticket offer ${p.classId} ${p.studentId ?? 'me'}`}</Text> };
});

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;
const idleMutation = () => ({ mutateAsync: jest.fn<(...args: unknown[]) => Promise<unknown>>(), isPending: false });

const classItem = { id: 'class-1', title: 'BJJ Fundamentals', startDate: '2026-11-02T18:00:00.000Z', endDate: '2026-11-02T19:00:00.000Z' };

/** Decision 322 — only "full" and "students already waiting" lead to the
 * waitlist; any other refusal is shown as it is, with Book still offered. */
describe('ClassBookingRow — booking refusals', () => {
  let book: ReturnType<typeof idleMutation>;
  let join: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    book = idleMutation();
    join = idleMutation();
    mocked(bookingQueries.useBookClass).mockReturnValue(book);
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({ data: { items: [] } });
    mocked(bookingQueries.useBookingGuests).mockReturnValue({ isLoading: false, error: null, data: { bookingId: 'booking-1', waiverRequired: false, guests: [] } });
    mocked(waitlistMutations.useJoinWaitlist).mockReturnValue(join);
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
  });

  it('offers the waitlist when the class is full, and joins it', async () => {
    book.mutateAsync.mockRejectedValue(new ApiError(409, 'CLASS_FULL', 'This Class is full for the requested party size — join the waitlist instead (POST /classes/{id}/waitlist).'));
    join.mutateAsync.mockResolvedValue({ id: 'entry-1', position: 3 });
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('This class is full.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Join waitlist'));
    await waitFor(() => expect(screen.getByText("You're #3 on the waitlist.")).toBeTruthy());
  });

  it('says others are waiting when the API puts the queue first', async () => {
    book.mutateAsync.mockRejectedValue(new ApiError(409, 'WAITLIST_FIRST', 'Students are waiting for this Class. Join the waitlist instead (POST /classes/{id}/waitlist).'));
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('Others are already waiting for a place in this class.')).toBeTruthy());
    expect(screen.getByText('Join waitlist')).toBeTruthy();
  });

  it('keeps Book for a busy class and shows a clear message, not the waitlist', async () => {
    book.mutateAsync.mockRejectedValue(new ApiError(409, 'CLASS_BUSY', 'This Class is very busy right now. Please try again in a moment.'));
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('Lots of people are booking this class right now. Please try again in a moment.')).toBeTruthy());
    expect(screen.queryByText('Join waitlist')).toBeNull();
    expect(screen.getByText('Book')).toBeTruthy();
  });

  it('offers the one-off class\'s ticket when booking says it needs one (Decision 428, M4)', async () => {
    book.mutateAsync.mockRejectedValue(new ApiError(400, 'TICKET_REQUIRED', 'This one-off class needs its own ticket.'));
    const screen = await render(<ClassBookingRow classItem={classItem} schoolId="school-1" />);
    expect(screen.queryByText('ticket offer class-1 me')).toBeNull();
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('ticket offer class-1 me')).toBeTruthy());
    expect(screen.getByText('Book')).toBeTruthy();
  });

  it('explains that booking has closed', async () => {
    book.mutateAsync.mockRejectedValue(new ApiError(400, 'BOOKING_CLOSED', 'Booking for this Class has closed. Ask a member of staff if you want to join.'));
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('Booking for this class has closed. A member of staff can still add you.')).toBeTruthy());
  });
});

/** Decision 353 (Q6) — the slot's break is shown on the class card, only when set. */
describe('ClassBookingRow — break', () => {
  beforeEach(() => {
    mocked(bookingQueries.useBookClass).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useJoinWaitlist).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({ data: { items: [] } });
  });

  it('shows the break when the class has one', async () => {
    const screen = await render(
      <ClassBookingRow classItem={{ ...classItem, breakStartAt: '2026-11-02T18:20:00.000Z', breakEndAt: '2026-11-02T18:30:00.000Z' }} />,
    );
    expect(screen.getByText(/^Break /)).toBeTruthy();
  });

  it("shows the times and break on the class's own clock (Decision 427, SP6)", async () => {
    const screen = await render(
      <ClassBookingRow
        classItem={{ ...classItem, timezone: 'Asia/Tokyo', breakStartAt: '2026-11-02T18:20:00.000Z', breakEndAt: '2026-11-02T18:30:00.000Z' }}
      />,
    );
    expect(screen.getByText(/^Tue, Nov 3, 2026, 3:00\sAM – 4:00\sAM$/)).toBeTruthy();
    expect(screen.getByText(/^Break 3:20\sAM/)).toBeTruthy();
  });

  it('shows no break line without one', async () => {
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    expect(screen.queryByText(/^Break /)).toBeNull();
  });

  it('says when a class ends the next day on its own clock (Decision 431 item 3)', async () => {
    // 23:00–00:30 in Tokyo.
    const screen = await render(
      <ClassBookingRow classItem={{ ...classItem, timezone: 'Asia/Tokyo', startDate: '2026-11-02T14:00:00.000Z', endDate: '2026-11-02T15:30:00.000Z' }} />,
    );
    expect(screen.getByText(/\(ends next day\)$/)).toBeTruthy();
  });

  it('shows who can book (Decision 431 item 14), and nothing for everyone', async () => {
    const screen = await render(<ClassBookingRow classItem={{ ...classItem, audience: 'WOMEN', minAge: 16, maxAge: null }} />);
    expect(screen.getByText('Women only · Ages 16+')).toBeTruthy();
    const plain = await render(<ClassBookingRow classItem={{ ...classItem, audience: 'EVERYONE' }} />);
    expect(plain.queryByText(/only|Ages/)).toBeNull();
  });
});

/** Waivers Q9 — guests paid for with the member's own Friend Passes. */
describe('ClassBookingRow — guests', () => {
  let book: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    book = idleMutation();
    mocked(bookingQueries.useBookClass).mockReturnValue(book);
    mocked(waitlistMutations.useJoinWaitlist).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
  });

  it('offers no guests without a usable Friend Pass', async () => {
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({ data: { items: [{ membershipId: 'p-other', scopedClassId: 'another-class', expiryDate: null }] } });
    const screen = await render(<ClassBookingRow classItem={classItem} schoolId="school-1" />);
    expect(screen.queryByText('Add a guest')).toBeNull();
  });

  it("books with one guest, using the class's own pass first, then shows the guest's link", async () => {
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({
      data: {
        items: [
          { membershipId: 'p-general', scopedClassId: null, expiryDate: null },
          { membershipId: 'p-this-class', scopedClassId: 'class-1', expiryDate: null },
        ],
      },
    });
    mocked(bookingQueries.useBookingGuests).mockReturnValue({
      isLoading: false,
      error: null,
      data: { bookingId: 'booking-1', waiverRequired: true, guests: [{ attendeeId: 'a1', link: 'https://portal.example/guest-waiver/tok', waiverStatus: 'UNSIGNED', guestFullName: null }] },
    });
    book.mutateAsync.mockResolvedValue({ id: 'booking-1' });
    const screen = await render(<ClassBookingRow classItem={classItem} schoolId="school-1" />);
    expect(screen.getByText('Friend Passes you can use for this class: 2')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add a guest'));
    expect(screen.getByText('Guests: 1')).toBeTruthy();
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('Booked ✓')).toBeTruthy());
    expect(book.mutateAsync).toHaveBeenCalledWith({ classId: 'class-1', guestPassIds: ['p-this-class'] });
    expect(screen.getByText('https://portal.example/guest-waiver/tok')).toBeTruthy();
    expect(screen.getByText('Share link')).toBeTruthy();
  });
});

/** Decision 379 — a parent booking their child: every call names the child,
 * and the passes shown are the child's. */
describe('ClassBookingRow — for a child', () => {
  let book: ReturnType<typeof idleMutation>;
  let join: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    book = idleMutation();
    join = idleMutation();
    mocked(bookingQueries.useBookClass).mockReturnValue(book);
    mocked(waitlistMutations.useJoinWaitlist).mockReturnValue(join);
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({ data: { items: [{ membershipId: 'child-pass', scopedClassId: null, expiryDate: null }] } });
    mocked(bookingQueries.useBookingGuests).mockReturnValue({ isLoading: false, error: null, data: { bookingId: 'booking-1', waiverRequired: false, guests: [] } });
  });

  it("uses the child's passes and books in the child's name", async () => {
    book.mutateAsync.mockResolvedValue({ id: 'booking-1' });
    const screen = await render(<ClassBookingRow classItem={classItem} schoolId="school-1" studentId="child-1" />);
    expect(bookingQueries.useMyFriendPasses).toHaveBeenCalledWith('school-1', 'child-1');
    expect(bookingQueries.useBookClass).toHaveBeenCalledWith('child-1');
    expect(screen.getByText("Your child's Friend Passes for this class: 1")).toBeTruthy();
    await fireEvent.press(screen.getByText('Add a guest'));
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('Booked ✓')).toBeTruthy());
    expect(book.mutateAsync).toHaveBeenCalledWith({ classId: 'class-1', guestPassIds: ['child-pass'] });
    expect(bookingQueries.useBookingGuests).toHaveBeenCalledWith('booking-1', 'child-1');
  });

  it('puts the child on the waitlist when the class is full', async () => {
    book.mutateAsync.mockRejectedValue(new ApiError(409, 'CLASS_FULL', 'full'));
    join.mutateAsync.mockResolvedValue({ id: 'entry-1', position: 2 });
    const screen = await render(<ClassBookingRow classItem={classItem} schoolId="school-1" studentId="child-1" />);
    expect(waitlistMutations.useJoinWaitlist).toHaveBeenCalledWith('child-1');
    await fireEvent.press(screen.getByText('Book'));
    await waitFor(() => expect(screen.getByText('Join waitlist')).toBeTruthy());
    await fireEvent.press(screen.getByText('Join waitlist'));
    await waitFor(() => expect(screen.getByText('Your child is #2 on the waitlist.')).toBeTruthy());
  });
});

/** Decision 427 — Student portal review SP6 and SP9. */
describe('ClassBookingRow — remembers what you already did', () => {
  beforeEach(() => {
    mocked(bookingQueries.useBookClass).mockReturnValue(idleMutation());
    mocked(bookingQueries.useMyFriendPasses).mockReturnValue({ data: { items: [] } });
    mocked(bookingQueries.useBookingGuests).mockReturnValue({ isLoading: false, error: null, data: { bookingId: 'booking-1', waiverRequired: false, guests: [] } });
    mocked(waitlistMutations.useJoinWaitlist).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useWithdrawWaitlist).mockReturnValue(idleMutation());
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [] } });
    mocked(bookingQueries.useMyBookings).mockReturnValue({ data: { pages: [{ items: [] }] } });
  });

  it('shows the class time, not only the date', async () => {
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    expect(screen.getByText(/2026, .+ – /)).toBeTruthy();
  });

  it('shows Booked, not Book, for a class already booked', async () => {
    mocked(bookingQueries.useMyBookings).mockReturnValue({ data: { pages: [{ items: [{ id: 'booking-1', classId: 'class-1', status: 'UPCOMING' }] }] } });
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    expect(screen.queryByText('Book')).toBeNull();
  });

  it('shows the waitlist place for a class already waited for', async () => {
    mocked(waitlistMutations.useMyWaitlist).mockReturnValue({ data: { items: [{ id: 'entry-1', classId: 'class-1', position: 2, status: 'WAITING' }] } });
    const screen = await render(<ClassBookingRow classItem={classItem} />);
    expect(screen.getByText("You're #2 on the waitlist.")).toBeTruthy();
    expect(screen.queryByText('Book')).toBeNull();
  });
});
