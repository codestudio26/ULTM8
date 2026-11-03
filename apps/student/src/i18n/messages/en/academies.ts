/** English text: academies (Decision 323). */
export const academies = {
  list: {
    empty: 'No academies found.',
    loadFailed: 'Failed to load academies — please try again.',
  },
  detail: {
    loadFailed: 'Failed to load this academy — please try again.',
    join: 'Join this School',
    addMyBelt: 'Add my belt',
    activities: 'Activities',
    membershipPlans: 'Membership Plans',
    upcomingClasses: 'Upcoming classes',
    timetable: 'Timetable',
    /** One timetable row: short weekday, then start and end time. */
    slot: '{weekday} · {start}–{end}',
    loadMore: 'Load more',
  },
  /** Short weekday names in the timetable. */
  weekday: {
    MONDAY: 'Mon',
    TUESDAY: 'Tue',
    WEDNESDAY: 'Wed',
    THURSDAY: 'Thu',
    FRIDAY: 'Fri',
    SATURDAY: 'Sat',
    SUNDAY: 'Sun',
  },
  signUpInvites: {
    title: 'Join {school}?',
    body: '{school} approved your sign-up at their front desk. Accept to become a student there.',
    bodyVisitor: '{school} approved your sign-up at their front desk. Accept to join as a Visitor, with a free visit pass.',
    homeBranch: 'Your home branch',
    accept: 'Accept',
    decline: 'No thanks',
    failed: "Couldn't answer the invite. Try again.",
  },
  childInvites: {
    title: "Add {child} to {school}?",
    body: "{school} would like to add {child} as a student, with you as their Guardian. Accept to add {child} to your account and enrol them.",
  },
  join: {
    /** The person themselves, in the "who is joining" list. */
    me: 'Me',
    loadFailed: 'Failed to load this School — please try again.',
    alreadyStudentMe: 'You are already a student here.',
    /** {name} is a child's name. */
    alreadyStudentOther: '{name} is already a student here.',
    /** {name} is the School's name. */
    title: 'Join {name}',
    whoIsJoining: 'Who is joining?',
    homeBranch: 'Home branch',
    homeBranchHelp: 'The branch you mainly train at. Its coaches look after your grading.',
    /** Decision 315 item 10: shown only when the School asks for it. */
    medicalTitle: 'Medical information',
    medicalLabelMe: 'Anything the coaches should know (optional)',
    /** {name} is a child's name. */
    medicalLabelOther: 'Anything the coaches should know about {name} (optional)',
    medicalHint: 'For example allergies, asthma or injuries. Up to 2,000 characters.',
    medicalConsentLabel: 'Consent to keep medical information',
    /** {school} is the School's name. */
    medicalConsentMe: 'I agree that {school} keeps this medical information. Only the owner and the staff they allow can see it.',
    /** {name} is a child's name; {school} is the School's name. */
    medicalConsentOther: "As {name}'s Guardian, I agree that {school} keeps this medical information. Only the owner and the staff they allow can see it.",
    medicalConsentNeeded: 'Turn on consent to join with this medical information, or leave it empty.',
    joinFailed: 'Could not join — please try again.',
    submit: 'Join',
  },
  belts: {
    /** {style} is a martial-arts style, e.g. "Judo". */
    saveFailed: 'Could not save the {style} belt — please try again.',
    titleMe: 'Your current belt',
    /** {name} is a child's name. */
    titleOther: "{name}'s current belt",
    loadFailed: 'Could not load the belts — please try again.',
    nothingToAdd: 'Nothing to add here: the School grades you from your first class.',
    done: 'Done',
    chooseMe: 'Choose your belt in each style you train. Never graded? Choose the first belt. Any other belt waits for the School to check it.',
    chooseOther: 'Choose their belt in each style they train. Never graded? Choose the first belt. Any other belt waits for the School to check it.',
    dontTrain: "I don't train this",
    save: 'Save',
    notNow: 'Not now',
  },
  schoolPick: {
    title: 'Find your School',
    intro: 'Search by name, or enter the join code your School gave you.',
    searchTab: 'Search',
    joinCodeTab: 'Join code',
    schoolName: 'School name',
    schoolNamePlaceholder: 'e.g. Downtown Jiu-Jitsu',
    searchFailed: 'Could not search — please try again.',
    /** {query} is what the person typed. */
    noMatch: 'No School matched “{query}”.',
    joinCode: 'Join code',
    joinCodePlaceholder: 'e.g. DDZ8KFAA',
    findMySchool: 'Find my School',
    codeNotFound: 'No School has that join code — check with your School and try again.',
    lookupFailed: 'Could not look that up — please try again.',
    tapToContinue: 'Tap above to continue with this School.',
  },
};
