/** English text: bookings (Decision 323). */
export const bookings = {
  myBookings: {
    /** Row heading; the API gives only the Class's id, not its name. */
    classLabel: 'Class {classId}',
    /** {status} is one of `statusLabel` below. */
    status: 'Status: {status}',
    cancelError: 'Could not cancel this booking — please try again.',
    codeError: 'Incorrect or expired code — ask Staff for the current code.',
    cancelConfirm: 'Cancel booking? This cannot be undone.',
    keepBooking: 'Keep booking',
    cancelBooking: 'Cancel booking',
    codeInstructions: "Type the code shown on the Class's check-in screen. No camera needed.",
    cancel: 'Cancel',
    checkIn: 'Check in',
    checkInWithCode: 'Check in with code',
    empty: 'No bookings yet.',
    loadError: 'Failed to load bookings — please try again.',
  },
  classRow: {
    /** A Class's start and end dates. */
    dateRange: '{start} – {end}',
    /** Decision 353 (Q6): the class's break, shown only. */
    breakLine: 'Break {start} – {end}',
    bookError: 'Could not book this class — please try again.',
    joinWaitlistError: 'Could not join the waitlist — please try again.',
    leaveWaitlistError: 'Could not leave the waitlist — please try again.',
    book: 'Book',
    booked: 'Booked ✓',
    othersWaiting: 'Others are already waiting for a place in this class.',
    full: 'This class is full.',
    joinWaitlist: 'Join waitlist',
    /** {position} is the Student's place in the waitlist queue (1, 2, 3…). */
    waitlistPosition: "You're #{position} on the waitlist.",
    leaveWaitlist: 'Leave waitlist',
  },
  /** Guests on a booking, each paid for with one of the member's Friend
   * Passes, and the link each guest signs the waiver with (Waivers Q9). */
  guests: {
    /** {count} is how many guests are being booked. */
    count: 'Guests: {count}',
    add: 'Add a guest',
    remove: 'Remove a guest',
    /** {count} is how many of the member's Friend Passes can pay for a guest in this class. */
    passesLeft: 'Friend Passes you can use for this class: {count}',
    linksIntro: 'Send each guest their link, so they can sign the waiver before the class.',
    /** {number} is 1, 2, 3… in booking order. */
    guestNumber: 'Guest {number}',
    signed: 'Waiver signed: {name}',
    unsigned: "Hasn't signed the waiver yet",
    share: 'Share link',
    shareMessage: 'Please sign the waiver before the class: {link}',
    noLink: "The signing link isn't available. Ask the School to send it.",
    noShare: 'Sharing is not available here. Copy the link above and send it to your guest.',
    loadError: 'Could not load your guests — please try again.',
  },
  /** A booking's status, in capitals as the app has always shown it. */
  statusLabel: {
    upcoming: 'UPCOMING',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED',
    noShow: 'NO_SHOW',
  },
};
