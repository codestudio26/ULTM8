/** English text: kidmode (Decision 323). */
export const kidmode = {
  pin: {
    tooShort: { one: 'PIN must be {count} digit.', other: 'PIN must be {count} digits.' },
    mismatch: 'PINs do not match.',
    incorrect: 'Incorrect PIN.',
    setTitle: 'Set a Kid Mode PIN',
    setIntro: "You'll enter this each time before handing the device over. It's just a handoff check — not a password.",
    newPin: 'New PIN',
    confirmPin: 'Confirm PIN',
    setPin: 'Set PIN',
    enterTitle: 'Enter Kid Mode PIN',
    pin: 'PIN',
    continue: 'Continue',
  },
  booking: {
    loadError: 'Could not load Kid Mode — please try again.',
    noneEnabled: 'No minor is currently enabled for Kid Mode.',
    noneEnabledHint: "Enable it from a minor's own settings first.",
    startError: 'Could not start Kid Mode for this minor — please try again.',
    classFull: 'This class is full.',
    bookError: 'Could not book this class — please try again.',
    whosBooking: "Who's booking?",
    /** {name} is the minor's full name. */
    bookingFor: 'Booking for {name}',
    bookingForFallback: 'Booking for this minor',
    switchMinor: 'Switch minor',
    pickAcademy: 'Pick an academy',
    backToAcademies: 'Back to academies',
    /** A class's start and end, each already formatted as a date and time. */
    dateRange: '{start} – {end}',
    booked: 'Booked ✓',
    book: 'Book',
  },
  pendingReview: {
    loadError: 'Could not load your review queue — please try again.',
    confirmError: 'Could not confirm this booking — please try again.',
    cancelError: 'Could not cancel this booking — please try again.',
    empty: 'Nothing needs your review right now.',
    intro: 'These were booked under Kid Mode before it was disabled. Confirm to keep them, or cancel to release the credit.',
    /** Shown instead of a minor's name when it isn't known. */
    linkedMinor: 'Linked minor',
    confirm: 'Confirm',
    cancel: 'Cancel',
  },
};
