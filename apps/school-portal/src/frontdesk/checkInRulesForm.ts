import type { components } from '@ultm8/api-client';

export type CheckInRules = components['schemas']['CheckInRulesDto'];

/** The Check-in rules form (Decision 394) as the page edits it. */
export type CheckInRulesForm = Omit<CheckInRules, 'opensMinutesBeforeStart' | 'closesMinutesAfterStart' | 'blockOverdueDays' | 'requireBooking'> & {
  opensMinutesBeforeStart: string;
  closes: 'end' | 'after';
  closesMinutesAfterStart: string;
  /** Backlog §3.5: 'no' (default), '7' or '14' days after the due date. */
  overdue: 'no' | '7' | '14';
  /** Decision 422 item 2: the owner's "Check in without a booking" switch,
   * off by default. On is the API's requireBooking: false. */
  withoutBooking: boolean;
};

export function toCheckInRulesForm({ blockOverdueDays, requireBooking, ...r }: CheckInRules): CheckInRulesForm {
  return {
    ...r,
    overdue: blockOverdueDays === 7 ? '7' : blockOverdueDays === 14 ? '14' : 'no',
    opensMinutesBeforeStart: String(r.opensMinutesBeforeStart),
    closes: r.closesMinutesAfterStart === null ? 'end' : 'after',
    closesMinutesAfterStart: r.closesMinutesAfterStart === null ? '15' : String(r.closesMinutesAfterStart),
    // Left out of an older response: a booking is needed, as before.
    withoutBooking: requireBooking === false,
  };
}

/** What Save sends: every rule at once. */
export function checkInRulesBody(form: CheckInRulesForm): CheckInRules {
  return {
    opensMinutesBeforeStart: Number(form.opensMinutesBeforeStart),
    closesMinutesAfterStart: form.closes === 'end' ? null : Number(form.closesMinutesAfterStart),
    requireWaiver: form.requireWaiver,
    otherBranches: form.otherBranches,
    visitors: form.visitors,
    severalClasses: form.severalClasses,
    frozenMembers: form.frozenMembers ?? false,
    showBeltProgress: form.showBeltProgress ?? true,
    blockOverdueDays: form.overdue === '7' ? 7 : form.overdue === '14' ? 14 : null,
    requireBooking: !form.withoutBooking,
    codeDigits: form.codeDigits,
  };
}
