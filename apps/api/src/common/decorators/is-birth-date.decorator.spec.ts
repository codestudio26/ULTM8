import { ageOn, eighteenthBirthday, isAdultOn, isBirthDate, localDateIn } from './is-birth-date.decorator';

/** Decision 430 item 10 (FAM-10): the 18th birthday on the School's own date. */
describe('isAdultOn with a time zone', () => {
  const born = new Date('2008-11-05T00:00:00.000Z');
  // 21:30 UTC on 4 Nov = 08:30 on 5 Nov in Sydney, 11:30 on 4 Nov in Honolulu.
  const now = new Date('2026-11-04T21:30:00.000Z');

  it('is an adult in Sydney, where it is already the birthday', () => {
    expect(isAdultOn(born, now, 'Australia/Sydney')).toBe(true);
  });

  it('is still a minor in Honolulu, where it is the day before', () => {
    expect(isAdultOn(born, now, 'Pacific/Honolulu')).toBe(false);
  });

  it('counts on the UTC date without a zone, or with an unknown one', () => {
    expect(isAdultOn(born, now)).toBe(false);
    expect(isAdultOn(born, now, 'Not/AZone')).toBe(false);
    expect(isAdultOn(born, new Date('2026-11-05T00:00:00.000Z'))).toBe(true);
  });

  it('in Kolkata, from midnight local (18:30 UTC the day before)', () => {
    expect(isAdultOn(born, new Date('2026-11-04T18:29:00.000Z'), 'Asia/Kolkata')).toBe(false);
    expect(isAdultOn(born, new Date('2026-11-04T18:31:00.000Z'), 'Asia/Kolkata')).toBe(true);
  });

  it('treats an unknown date of birth as under 18', () => {
    expect(isAdultOn(null, now, 'Australia/Sydney')).toBe(false);
  });

  it('counts a 29 February birthday from 1 March in a common year', () => {
    const leap = new Date('2008-02-29T00:00:00.000Z');
    expect(isAdultOn(leap, new Date('2026-02-28T12:00:00.000Z'), 'UTC')).toBe(false);
    expect(isAdultOn(leap, new Date('2026-03-01T12:00:00.000Z'), 'UTC')).toBe(true);
    expect(eighteenthBirthday(leap)).toBe('2026-03-01');
  });

  it('gives whole years and the local date', () => {
    expect(ageOn(born, now, 'Australia/Sydney')).toBe(18);
    expect(ageOn(born, now, 'Pacific/Honolulu')).toBe(17);
    expect(localDateIn(now, 'Australia/Sydney')).toBe('2026-11-05');
    expect(localDateIn(now, null)).toBe('2026-11-04');
  });
});

describe('isBirthDate', () => {
  it('accepts today anywhere on Earth (UTC+14), never a later day', () => {
    const now = new Date('2026-11-04T21:30:00.000Z'); // already 5 Nov in Kiritimati and Sydney
    expect(isBirthDate('2026-11-05', now)).toBe(true);
    expect(isBirthDate('2026-11-06', now)).toBe(false);
  });

  it('refuses impossible dates', () => {
    expect(isBirthDate('2017-02-30')).toBe(false);
    expect(isBirthDate('1800-01-01')).toBe(false);
  });
});
