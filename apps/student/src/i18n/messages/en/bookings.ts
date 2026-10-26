/** English text: bookings (Decision 323). */
export const bookings = {
  myBookings: {
    /** Row heading; the API gives only the Class's id, not its name. */
    classLabel: 'Class {classId}',
    /** {status} is the Booking status code from the API (e.g. UPCOMING), shown as is. */
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
};
