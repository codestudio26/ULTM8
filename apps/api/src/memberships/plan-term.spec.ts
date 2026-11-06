import { DateTime } from 'luxon';
import { assertPlanTermValid, fixedPlanOver, membershipTerm, planDay } from './plan-term';

const none = { startsOnFirstCheckIn: false, fixedStartDate: null, fixedEndDate: null };

describe('plan start and end (Decision 435 items 7-8)', () => {
  it('refuses a day that does not exist', () => {
    expect(planDay('2027-02-28').toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(() => planDay('2027-02-30')).toThrow('Give real days');
  });

  it('checks the settings an owner saves', () => {
    expect(() => assertPlanTermValid('WEEKLY_PASS', { ...none, startsOnFirstCheckIn: true }, 7)).not.toThrow();
    expect(() => assertPlanTermValid('SUBSCRIPTION', { ...none, startsOnFirstCheckIn: true }, null)).toThrow();
    expect(() => assertPlanTermValid('CLASS_PACK', { ...none, startsOnFirstCheckIn: true }, null)).toThrow('number of days');
    const camp = { startsOnFirstCheckIn: false, fixedStartDate: planDay('2027-07-01'), fixedEndDate: planDay('2027-08-11') };
    expect(() => assertPlanTermValid('WEEKLY_PASS', camp, null)).not.toThrow();
    expect(() => assertPlanTermValid('WEEKLY_PASS', camp, 7)).toThrow();
    expect(() => assertPlanTermValid('WEEKLY_PASS', { ...camp, fixedEndDate: planDay('2027-06-30') }, null)).toThrow('on or after');
  });

  it('works out a membership: fixed dates in the School zone, first check-in with no end, else N days', () => {
    const zone = 'Asia/Tokyo';
    const now = new Date('2027-06-15T03:00:00Z');
    const camp = membershipTerm({ expiryDurationDays: null, fixedStartDate: planDay('2027-07-01'), fixedEndDate: planDay('2027-08-11') }, zone, now);
    expect(camp.startDate.toISOString()).toBe(DateTime.fromISO('2027-07-01', { zone }).toJSDate().toISOString());
    expect(camp.expiryDate!.toISOString()).toBe(DateTime.fromISO('2027-08-12', { zone }).toJSDate().toISOString());
    const started = membershipTerm({ expiryDurationDays: null, fixedStartDate: planDay('2027-06-01'), fixedEndDate: planDay('2027-08-11') }, zone, now);
    expect(started.startDate).toBe(now);
    expect(membershipTerm({ expiryDurationDays: 7, startsOnFirstCheckIn: true }, zone, now)).toEqual({ startDate: now, expiryDate: undefined, awaitingFirstCheckIn: true });
    expect(membershipTerm({ expiryDurationDays: 7 }, zone, now).expiryDate!.toISOString()).toBe('2027-06-22T03:00:00.000Z');
  });

  it('a fixed-date plan is sold on its last day, not the day after (School zone)', () => {
    const plan = { fixedEndDate: planDay('2027-08-11') };
    expect(fixedPlanOver(plan, 'Asia/Tokyo', new Date('2027-08-11T14:00:00Z'))).toBe(false); // 23:00 on the 11th in Tokyo
    expect(fixedPlanOver(plan, 'Asia/Tokyo', new Date('2027-08-11T15:30:00Z'))).toBe(true); // 00:30 on the 12th
  });
});
