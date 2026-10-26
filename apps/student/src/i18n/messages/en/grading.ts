/** English text: grading (Decision 323). */
export const grading = {
  myGrading: {
    loadError: 'Could not load the grading — please try again.',
    noRank: 'No rank yet. Ranks show here once the School grades you, or you declare your belt when joining.',
    /** The title of a style's history screen. */
    historyTitle: '{style} history',
    /** A style card: {style} at {school}. */
    styleAtSchool: '{style} at {school}',
    since: 'Since {date}',
    unverified: 'Waiting for the School to verify this belt.',
    topOfLadder: 'Top of the ladder.',
    next: 'Next: {rank}',
    progress: '{percent}% of the way',
    readyToGrade: 'Ready to grade',
    skillsOptional: 'Skills (optional)',
    skillsForNextGrade: 'Skills for the next grade',
    /** A skill and its status, e.g. "Armbar: Signed off". */
    skillStatus: '{name}: {status}',
    history: 'History',
  },
  /** The progress breakdown. {tick} is ✓ when a requirement is met, · when not.
   * "the %" is the progress percentage shown above it. */
  breakdown: {
    classes: '{tick} Classes: {counted} of {required} · {percent}% · counts toward the %',
    classType: {
      one: '{tick} {classType}: {counted} of {count} class',
      other: '{tick} {classType}: {counted} of {count} classes',
    },
    days: '{tick} Days at this rank: {elapsed} of {required} · {percent}%',
    daysNeededToo: '{tick} Days at this rank: {elapsed} of {required} · {percent}% · needed too, not in the %',
    daysNoMinimum: '{tick} Days at this rank: {elapsed} (no minimum) · {percent}%',
    daysCounts: '{tick} Days at this rank: {elapsed} of {required} · {percent}% · counts toward the %',
    daysNoMinimumCounts: '{tick} Days at this rank: {elapsed} (no minimum) · {percent}% · counts toward the %',
    skills: '{tick} Skills signed off: {signedOff} of {required} · {percent}% · needed too, not in the %',
    timeOnlyNote: 'The % is days at this rank out of days required.',
    classesNote: 'The % is classes out of classes required.',
  },
  hours: {
    title: 'Hours trained',
    /** {atRank} and {total} are hours, e.g. "1.5". */
    summary: '{atRank} h at this rank · {total} h in all',
    note: "A record of your time on the mat. Grading doesn't use it.",
  },
  /** A promotion fee the student (or their guardian) accepts or declines. */
  fee: {
    a11yLabel: 'Promotion fee: {rank}',
    title: 'Promotion fee',
    gradedSelf: 'You were graded to {rank}',
    /** Shown to a guardian: {name} is their child. */
    gradedChild: '{name} was graded to {rank}',
    /** {style} at {school}, then the fee amount. */
    styleAtSchoolAmount: '{style} at {school} · {amount}',
    /** {place} is the style or the School, then the fee amount. */
    placeAmount: '{place} · {amount}',
    answerError: 'Could not send your answer — please try again.',
    accepted: 'You accepted the fee. The promotion to {rank} goes through once it is paid. Pay at the desk or as the School asks.',
    seeAndAnswer: 'See and answer',
    gradedOn: 'Graded on {date}.',
    nothingChargedSelf: 'Nothing is charged until you accept it. Your promotion goes through once the fee is accepted and paid.',
    /** Shown to a guardian: {name} is their child. */
    nothingChargedChild: "Nothing is charged until you accept it. {name}'s promotion goes through once the fee is accepted and paid.",
    confirmDecline: "Decline the {amount} fee? The School is told, and the promotion to {rank} doesn't go ahead.",
    yesDecline: 'Yes, decline',
    keepIt: 'Keep it',
    accept: 'Accept {amount}',
    decline: 'Decline',
  },
  history: {
    loadError: 'Could not load the history — please try again.',
    nothingYet: 'Nothing yet.',
    /** A history entry: {event} is what happened, {rung} the stripe it moved to. */
    eventWithRung: '{event}: {rung}',
    reason: 'Reason: {reason}',
  },
  skillStatus: {
    notStarted: 'Not started',
    learning: 'Learning',
    signedOff: 'Signed off',
  },
  events: {
    promotion: 'Promoted',
    stripeAward: 'Stripe awarded',
    downgrade: 'Moved down',
    adjustment: 'Progress adjusted',
    selfDeclared: 'Belt declared',
    rankCorrection: 'Belt corrected',
  },
};
