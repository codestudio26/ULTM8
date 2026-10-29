/** English text: guardians (Decision 323). */
export const guardians = {
  myMinors: {
    empty: 'No linked minors yet.',
    loadError: 'Failed to load your minors — please try again.',
    born: 'Born {date}',
    grading: 'Grading',
    lessons: 'Lessons',
    notes: "Notes",
    firstName: 'First name',
    surname: 'Surname',
    dateOfBirth: 'Date of birth',
    /** Format hint shown under the date-of-birth field. */
    dateOfBirthHint: 'YYYY-MM-DD',
    /** Example date shown inside the empty date-of-birth field, in the format it must be typed. */
    dateOfBirthPlaceholder: '2015-06-01',
    addError: 'Could not add this minor — please try again.',
    addMinor: 'Add minor',
    addAMinor: 'Add a minor',
    bookAClass: 'Book a class',
  },
  /** Decision 379: a parent books classes, with guests, for their child. */
  childBooking: {
    /** Screen title; {name} is the child's first name. */
    title: 'Book for {name}',
    upcomingTitle: 'Upcoming bookings',
    noBookings: '{name} has no upcoming bookings.',
    bookTitle: 'Book a class',
    noSchools: "{name} isn't a student at any School yet.",
    noClasses: 'No upcoming classes at this School.',
    loadError: "Could not load your child's Schools — please try again.",
    bookingsLoadError: "Could not load your child's bookings — please try again.",
    classesLoadError: 'Could not load the classes — please try again.',
  },
  minorConsent: {
    loadError: "Failed to load this minor's settings — please try again.",
  },
  consentTier: {
    baselineTitle: 'Baseline consent',
    baselineDescription:
      "Covers your minor's general account, attendance, and grading data — required for their account to stay active.",
    baselineWithdrawWarning:
      "Withdrawing baseline consent deactivates your minor's entire account — every role and enrollment they hold is revoked, the same effect as closing their account. This cannot be undone from this screen.",
    cameraTitle: 'Camera & photo consent',
    cameraDescription: 'Covers self-service QR check-in camera use and profile-photo capture.',
    cameraWithdrawWarning:
      "Withdrawing camera consent disables self-service QR check-in and clears your minor's stored profile photo. It does not affect their account, attendance, or grading history.",
    grantError: 'Could not save consent — please try again.',
    withdrawError: 'Could not withdraw consent — please try again.',
    acknowledge: 'I understand this deactivates the account',
    cancel: 'Cancel',
    confirmWithdraw: 'Confirm withdraw',
    active: 'Active ✓',
    withdraw: 'Withdraw',
    grantConsent: 'Grant consent',
  },
  bookingDelegation: {
    title: 'Kid Mode — self-booking',
    description:
      "Lets your minor book a class themselves, from your device, against a class credit you've already paid for — never a purchase, cancellation, or waiver signature.",
    enableError: 'Could not enable Kid Mode — please try again.',
    disableError: 'Could not disable Kid Mode — please try again.',
    enabled: 'Enabled ✓',
    disable: 'Disable Kid Mode',
    enable: 'Enable Kid Mode',
  },
};
