import { describe, expect, it } from '@jest/globals';
import { checkInRulesBody, toCheckInRulesForm, type CheckInRules } from './checkInRulesForm';

const DEFAULTS: CheckInRules = {
  opensMinutesBeforeStart: 30,
  closesMinutesAfterStart: null,
  requireWaiver: false,
  otherBranches: true,
  visitors: true,
  severalClasses: true,
  frozenMembers: false,
  showBeltProgress: true,
  blockOverdueDays: null,
  requireBooking: true,
  openMatUsesCredit: true,
  codeDigits: 4,
};

/** Decision 422 item 2: the owner's "Check in without a booking" switch. */
describe('"Check in without a booking" on the check-in rules card', () => {
  it('is off by default, while a booking is needed', () => {
    expect(toCheckInRulesForm(DEFAULTS).withoutBooking).toBe(false);
  });

  it('is off when an older response leaves the setting out', () => {
    const { requireBooking: _omitted, ...older } = DEFAULTS;
    expect(toCheckInRulesForm(older).withoutBooking).toBe(false);
  });

  it('is on when the School no longer needs a booking', () => {
    expect(toCheckInRulesForm({ ...DEFAULTS, requireBooking: false }).withoutBooking).toBe(true);
  });

  it('saves as requireBooking, the other way round, and leaves the other rules as they were', () => {
    const form = toCheckInRulesForm(DEFAULTS);
    expect(checkInRulesBody(form)).toEqual(DEFAULTS);
    expect(checkInRulesBody({ ...form, withoutBooking: true })).toEqual({ ...DEFAULTS, requireBooking: false });
  });
});

/** Decision 304 item 3: "Open mat uses a class credit", on by default. */
describe('"Open mat uses a class credit" on the check-in rules card', () => {
  it('saves what the switch says', () => {
    const form = toCheckInRulesForm({ ...DEFAULTS, openMatUsesCredit: false });
    expect(checkInRulesBody(form).openMatUsesCredit).toBe(false);
  });

  it('is on when an older response leaves the setting out', () => {
    const { openMatUsesCredit: _omitted, ...older } = DEFAULTS;
    expect(checkInRulesBody(toCheckInRulesForm(older)).openMatUsesCredit).toBe(true);
  });
});
