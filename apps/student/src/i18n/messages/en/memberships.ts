/** English text: memberships (Decision 323). */
export const memberships = {
  recharge: {
    title: 'Your Class Pack has run out',
    titleChild: "{name}'s Class Pack has run out",
    body: "{school} offered the same pack at the front desk. Buy it here, and the check-in finishes as soon as it's paid.",
  },
  myMemberships: {
    /** Shown when the plan's name isn't known; the API gives only the plan's id. */
    planFallback: 'Plan {planId}',
    visitPass: 'Visit pass',
    /** {status} is one of `statusLabel` below;
     * {frequency} is one of the two frequency texts below. */
    statusLine: 'Status: {status} · {frequency}',
    recurring: 'Recurring',
    oneTime: 'One time',
    classesRemaining: { one: '{count} class remaining', other: '{count} classes remaining' },
    expires: 'Expires {date}',
    empty: 'No memberships yet.',
    loadError: 'Failed to load memberships — please try again.',
    cancelSubscription: 'Cancel subscription',
    keepSubscription: 'Keep it',
    cancelConfirm: 'You keep your subscription until the end of the month you have paid for. It then ends, and no more payments are taken.',
    cancelError: 'Could not cancel your subscription — please try again.',
    cancelledEnds: 'Cancelled, ends {date}',
  },
  planRow: {
    cardSurcharge: "+ {amount} card surcharge when paying by card",
    /** Joined to the price with " · ". */
    classesIncluded: { one: '{count} class', other: '{count} classes' },
    /** How long the plan lasts; joined to the price with " · ". */
    durationDays: { one: '{count} day', other: '{count} days' },
    purchaseError: 'Could not complete this purchase — please try again.',
    friendPass: 'Ask School staff for a Friend Pass.',
    purchase: 'Purchase',
    payWithSavedCard: 'Pay with saved card',
    enrolled: "You're enrolled ✓",
    pendingConfirmation: 'Payment pending confirmation by the School.',
    checkoutSubmitted: "Payment submitted — check My Memberships shortly once it's confirmed.",
    onlinePaymentUnavailable: "Online payment for this plan isn't available in the app yet.",
  },
  /** A membership's status, in capitals as the app has always shown it. */
  statusLabel: {
    active: 'ACTIVE',
    expired: 'EXPIRED',
  },
};
