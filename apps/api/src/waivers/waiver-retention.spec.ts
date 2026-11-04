import {
  addYearsUtc,
  decideGuestSignatureRetention,
  decideMemberSignatureRetention,
  MemberSignatureRetentionInput,
  PLATFORM_WAIVER_RETENTION_POLICY,
  signedAsChild,
  waiverRetentionPolicyFor,
} from './waiver-retention';

const d = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);

const STUDENT = 'student-1';
const GUARDIAN = 'guardian-1';

/** An adult who signed online on 1 Jan 2020 and is still a member. */
function base(over: Partial<MemberSignatureRetentionInput> = {}): MemberSignatureRetentionInput {
  return {
    status: 'SIGNED',
    studentId: STUDENT,
    signedById: STUDENT,
    signedDate: d('2020-01-01'),
    createdAt: d('2019-12-01'),
    studentMajorityDate: d('2008-05-10'), // born 1990-05-10
    hasLiveStudentRole: true,
    everMember: true,
    lastLeftAt: null,
    schoolClosedAt: null,
    schoolClosureFinal: false,
    ...over,
  };
}

describe('waiver retention policy', () => {
  it('is one platform-wide default: 18, and 7 years', () => {
    expect(PLATFORM_WAIVER_RETENTION_POLICY).toEqual({ ageOfMajorityYears: 18, yearsKeptAfterLeaving: 7 });
    expect(waiverRetentionPolicyFor({ country: 'GB' })).toBe(PLATFORM_WAIVER_RETENTION_POLICY);
    expect(waiverRetentionPolicyFor()).toBe(PLATFORM_WAIVER_RETENTION_POLICY);
    expect(Object.isFrozen(PLATFORM_WAIVER_RETENTION_POLICY)).toBe(true);
  });

  it('adds years in UTC, and 29 February lands on 1 March in a common year', () => {
    expect(addYearsUtc(d('2020-03-15T23:30:00.000Z'), 7).toISOString()).toBe('2027-03-15T23:30:00.000Z');
    expect(addYearsUtc(d('2008-02-29'), 18).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(addYearsUtc(d('2008-02-29'), 4).toISOString()).toBe('2012-02-29T00:00:00.000Z');
  });
});

describe('decideMemberSignatureRetention', () => {
  it('keeps any signature while the person is a member, however old', () => {
    const r = decideMemberSignatureRetention(base({ signedDate: d('1990-01-01') }), d('2060-01-01'));
    expect(r).toEqual({ action: 'keep', reason: 'MEMBER' });
  });

  it('keeps a child\'s signature long past 25 while they are still a member', () => {
    const child = base({ signedById: GUARDIAN, signedDate: d('2010-01-01'), studentMajorityDate: d('2015-06-01') });
    expect(decideMemberSignatureRetention(child, d('2060-01-01'))).toEqual({ action: 'keep', reason: 'MEMBER' });
  });

  it('adult who left: kept for 7 years after leaving, then purged', () => {
    const left = base({ hasLiveStudentRole: false, lastLeftAt: d('2021-04-02T10:00:00.000Z') });
    expect(decideMemberSignatureRetention(left, d('2028-04-02T09:59:59.000Z'))).toMatchObject({ action: 'keep', reason: 'NOT_YET_DUE', rule: 'ADULT_LEFT' });
    expect(decideMemberSignatureRetention(left, d('2028-04-02T10:00:00.000Z'))).toEqual({
      action: 'purge',
      rule: 'ADULT_LEFT',
      retainUntil: d('2028-04-02T10:00:00.000Z'),
    });
  });

  it('child who left: the later of 7 years after leaving and age 25 — age 25 later', () => {
    // Born 2005-03-01, signed at 12, left in 2020 at 15: 25 (2030) is after 2027.
    const child = base({
      signedById: GUARDIAN,
      signedDate: d('2017-03-01'),
      studentMajorityDate: d('2023-03-01'),
      hasLiveStudentRole: false,
      lastLeftAt: d('2020-01-01'),
    });
    expect(decideMemberSignatureRetention(child, d('2029-12-31'))).toMatchObject({ action: 'keep', rule: 'CHILD_LEFT', retainUntil: d('2030-03-01') });
    expect(decideMemberSignatureRetention(child, d('2030-03-01'))).toEqual({ action: 'purge', rule: 'CHILD_LEFT', retainUntil: d('2030-03-01') });
  });

  it('child who left: the later of 7 years after leaving and age 25 — leaving + 7 later', () => {
    // Born 2000-01-01, signed at 16, left at 30 (2030): 2037 is after 25 (2025).
    const child = base({
      signedById: GUARDIAN,
      signedDate: d('2016-01-01'),
      studentMajorityDate: d('2018-01-01'),
      hasLiveStudentRole: false,
      lastLeftAt: d('2030-01-01'),
    });
    expect(decideMemberSignatureRetention(child, d('2036-12-31'))).toMatchObject({ action: 'keep', rule: 'CHILD_LEFT', retainUntil: d('2037-01-01') });
    expect(decideMemberSignatureRetention(child, d('2037-01-01'))).toMatchObject({ action: 'purge', rule: 'CHILD_LEFT' });
  });

  it('a child who signed for themselves still counts as a child (judged by date of birth, every method)', () => {
    const selfSignedChild = base({ signedById: STUDENT, signedDate: d('2016-01-01'), studentMajorityDate: d('2018-01-01'), hasLiveStudentRole: false, lastLeftAt: d('2016-06-01') });
    expect(decideMemberSignatureRetention(selfSignedChild, d('2024-01-01'))).toMatchObject({ action: 'keep', rule: 'CHILD_LEFT', retainUntil: d('2025-01-01') });
  });

  it('a Guardian-signed waiver of someone already 18 when it was signed is an adult\'s', () => {
    const r = decideMemberSignatureRetention(
      base({ signedById: GUARDIAN, signedDate: d('2019-01-01'), studentMajorityDate: d('2018-01-01'), hasLiveStudentRole: false, lastLeftAt: d('2019-06-01') }),
      d('2026-06-01'),
    );
    expect(r).toMatchObject({ action: 'purge', rule: 'ADULT_LEFT' });
  });

  it('rejoined: a live role keeps it however long ago an earlier membership ended', () => {
    const rejoined = base({ hasLiveStudentRole: true, lastLeftAt: d('2001-01-01') });
    expect(decideMemberSignatureRetention(rejoined, d('2040-01-01'))).toEqual({ action: 'keep', reason: 'MEMBER' });
  });

  it('rejoined and left again: counts from the latest leaving', () => {
    const r = decideMemberSignatureRetention(base({ hasLiveStudentRole: false, lastLeftAt: d('2025-01-01') }), d('2031-12-31'));
    expect(r).toMatchObject({ action: 'keep', retainUntil: d('2032-01-01') });
  });

  it('never a member of that School: 7 years from the signing date', () => {
    const never = base({ hasLiveStudentRole: false, everMember: false, signedDate: d('2020-07-01') });
    expect(decideMemberSignatureRetention(never, d('2027-06-30'))).toMatchObject({ action: 'keep', rule: 'ADULT_NEVER_MEMBER' });
    expect(decideMemberSignatureRetention(never, d('2027-07-01'))).toEqual({ action: 'purge', rule: 'ADULT_NEVER_MEMBER', retainUntil: d('2027-07-01') });
  });

  it('never a member, a child: not before age 25', () => {
    const never = base({ hasLiveStudentRole: false, everMember: false, signedById: GUARDIAN, signedDate: d('2020-07-01'), studentMajorityDate: d('2025-02-01') });
    expect(decideMemberSignatureRetention(never, d('2031-01-31'))).toMatchObject({ action: 'keep', rule: 'CHILD_NEVER_MEMBER', retainUntil: d('2032-02-01') });
    expect(decideMemberSignatureRetention(never, d('2032-02-01'))).toMatchObject({ action: 'purge', rule: 'CHILD_NEVER_MEMBER' });
  });

  it('no date of birth: a Guardian-signed waiver is a child\'s and is kept, flagged as needing a date of birth', () => {
    const noDob = base({ signedById: GUARDIAN, studentMajorityDate: null, hasLiveStudentRole: false, lastLeftAt: d('2000-01-01') });
    expect(decideMemberSignatureRetention(noDob, d('2090-01-01'))).toEqual({ action: 'keep', reason: 'NEEDS_DATE_OF_BIRTH', rule: 'CHILD_LEFT' });
    expect(signedAsChild(noDob)).toBeNull();
  });

  it('no date of birth: a self-signed waiver is an adult\'s', () => {
    const noDob = base({ studentMajorityDate: null, hasLiveStudentRole: false, lastLeftAt: d('2010-01-01') });
    expect(decideMemberSignatureRetention(noDob, d('2017-01-01'))).toMatchObject({ action: 'purge', rule: 'ADULT_LEFT' });
  });

  it('paper signature of a minor (no online signer): a child\'s by date of birth', () => {
    const paper = base({ signedById: null, signedDate: d('2012-09-01'), studentMajorityDate: d('2016-09-01'), hasLiveStudentRole: false, lastLeftAt: d('2013-01-01') });
    expect(decideMemberSignatureRetention(paper, d('2023-08-31'))).toMatchObject({ action: 'keep', rule: 'CHILD_LEFT', retainUntil: d('2023-09-01') });
    expect(decideMemberSignatureRetention(paper, d('2023-09-01'))).toMatchObject({ action: 'purge', rule: 'CHILD_LEFT' });
  });

  it('paper signature with no date of birth is treated as an adult\'s (no online signer to tell a Guardian from)', () => {
    const paper = base({ signedById: null, studentMajorityDate: null, hasLiveStudentRole: false, lastLeftAt: d('2010-01-01') });
    expect(decideMemberSignatureRetention(paper, d('2017-01-01'))).toMatchObject({ action: 'purge', rule: 'ADULT_LEFT' });
  });

  it('a 29 February birthday: 18 on 1 March, 25 on 1 March', () => {
    // Born 2008-02-29; the saved 18th birthday is 2026-03-01.
    const leapChild = { signedById: GUARDIAN, signedDate: d('2026-02-28'), studentMajorityDate: d('2026-03-01'), hasLiveStudentRole: false, lastLeftAt: d('2026-02-28') };
    expect(signedAsChild(base(leapChild))).toBe(true);
    expect(signedAsChild(base({ ...leapChild, signedDate: d('2026-03-01') }))).toBe(false);
    const r = decideMemberSignatureRetention(base(leapChild), d('2033-02-28T23:59:59.000Z'));
    expect(r).toMatchObject({ action: 'keep', rule: 'CHILD_LEFT', retainUntil: d('2033-03-01') });
    expect(decideMemberSignatureRetention(base(leapChild), d('2033-03-01'))).toMatchObject({ action: 'purge' });
  });

  it('closed School: everyone still a member there left on the day it closed', () => {
    const closed = base({ schoolClosedAt: d('2026-11-01'), lastLeftAt: null });
    expect(decideMemberSignatureRetention(closed, d('2033-10-31'))).toMatchObject({ action: 'keep', rule: 'ADULT_LEFT', retainUntil: d('2033-11-01') });
    expect(decideMemberSignatureRetention(closed, d('2033-11-01'))).toMatchObject({ action: 'purge', rule: 'ADULT_LEFT' });
  });

  it('closed School: someone who had already left keeps their own leaving date', () => {
    const r = decideMemberSignatureRetention(base({ schoolClosedAt: d('2026-11-01'), hasLiveStudentRole: false, lastLeftAt: d('2020-01-01') }), d('2027-01-01'));
    expect(r).toMatchObject({ action: 'purge', rule: 'ADULT_LEFT', retainUntil: d('2027-01-01') });
  });

  it('closed School: a child still a member is kept to the later of close + 7 and age 25', () => {
    const child = base({ signedById: GUARDIAN, signedDate: d('2024-01-01'), studentMajorityDate: d('2030-01-01'), schoolClosedAt: d('2026-01-01') });
    expect(decideMemberSignatureRetention(child, d('2036-12-31'))).toMatchObject({ action: 'keep', retainUntil: d('2037-01-01') });
  });

  it('merged duplicate: a live role on the kept record keeps the signature left on the duplicate', () => {
    // The input's hasLiveStudentRole covers the duplicate's own id and mergedIntoStudentId.
    const dup = base({ hasLiveStudentRole: true, lastLeftAt: d('2010-01-01') });
    expect(decideMemberSignatureRetention(dup, d('2040-01-01'))).toEqual({ action: 'keep', reason: 'MEMBER' });
  });

  it('an expired signature is kept and purged on the same rules as a signed one', () => {
    const expired = base({ status: 'EXPIRED', hasLiveStudentRole: false, lastLeftAt: d('2015-01-01') });
    expect(decideMemberSignatureRetention({ ...expired, hasLiveStudentRole: true }, d('2040-01-01'))).toEqual({ action: 'keep', reason: 'MEMBER' });
    expect(decideMemberSignatureRetention(expired, d('2022-01-01'))).toMatchObject({ action: 'purge', rule: 'ADULT_LEFT' });
  });

  it('a signed row with no signedDate counts from when it was made', () => {
    const r = decideMemberSignatureRetention(base({ signedDate: null, createdAt: d('2010-01-01'), hasLiveStudentRole: false, everMember: false }), d('2017-01-01'));
    expect(r).toMatchObject({ action: 'purge', rule: 'ADULT_NEVER_MEMBER' });
  });

  describe('unsigned and pending entries', () => {
    it.each(['UNSIGNED', 'PENDING'] as const)('%s: kept while a member, removed once they are not', (status) => {
      const entry = base({ status, signedById: null, signedDate: null, studentMajorityDate: null });
      expect(decideMemberSignatureRetention(entry, d('2030-01-01'))).toEqual({ action: 'keep', reason: 'MEMBER' });
      expect(decideMemberSignatureRetention({ ...entry, hasLiveStudentRole: false, lastLeftAt: d('2029-12-31') }, d('2030-01-01'))).toEqual({
        action: 'purge',
        rule: 'LEFT_UNSIGNED',
        retainUntil: null,
      });
      expect(decideMemberSignatureRetention({ ...entry, hasLiveStudentRole: false, everMember: false }, d('2030-01-01'))).toMatchObject({ action: 'purge', rule: 'LEFT_UNSIGNED' });
    });

    it('a closed School\'s are kept while it can still be reopened, removed once its closure is final', () => {
      const entry = base({ status: 'UNSIGNED', signedById: null, signedDate: null, schoolClosedAt: d('2026-01-01') });
      expect(decideMemberSignatureRetention(entry, d('2026-02-01'))).toEqual({ action: 'keep', reason: 'MEMBER' });
      expect(decideMemberSignatureRetention({ ...entry, schoolClosureFinal: true }, d('2026-04-02'))).toMatchObject({ action: 'purge', rule: 'LEFT_UNSIGNED' });
    });
  });
});

describe('decideGuestSignatureRetention', () => {
  it('an adult guest: 7 years after the class', () => {
    const guest = { classStartsAt: d('2020-05-05T18:00:00.000Z'), guestDateOfBirth: d('1990-01-01') };
    expect(decideGuestSignatureRetention(guest, d('2027-05-05T17:59:59.000Z'))).toMatchObject({ action: 'keep', rule: 'GUEST_ADULT' });
    expect(decideGuestSignatureRetention(guest, d('2027-05-05T18:00:00.000Z'))).toEqual({ action: 'purge', rule: 'GUEST_ADULT', retainUntil: d('2027-05-05T18:00:00.000Z') });
  });

  it('a guest under 18 at the class: not before they turn 25', () => {
    const guest = { classStartsAt: d('2020-05-05'), guestDateOfBirth: d('2010-01-01') };
    expect(decideGuestSignatureRetention(guest, d('2034-12-31'))).toMatchObject({ action: 'keep', rule: 'GUEST_CHILD', retainUntil: d('2035-01-01') });
    expect(decideGuestSignatureRetention(guest, d('2035-01-01'))).toMatchObject({ action: 'purge', rule: 'GUEST_CHILD' });
  });

  it('a guest whose 18th birthday is the day of the class is an adult; the day before it, a child', () => {
    expect(decideGuestSignatureRetention({ classStartsAt: d('2021-01-01'), guestDateOfBirth: d('2003-01-01') }, d('2027-12-30'))).toMatchObject({
      action: 'keep',
      rule: 'GUEST_ADULT',
      retainUntil: d('2028-01-01'),
    });
    expect(decideGuestSignatureRetention({ classStartsAt: d('2020-12-31'), guestDateOfBirth: d('2003-01-01') }, d('2027-12-31'))).toMatchObject({
      action: 'keep',
      rule: 'GUEST_CHILD',
      retainUntil: d('2028-01-01'),
    });
  });

  it('a guest born on 29 February is 25 on 1 March', () => {
    const guest = { classStartsAt: d('2020-01-01'), guestDateOfBirth: d('2008-02-29') };
    expect(decideGuestSignatureRetention(guest, d('2033-02-28')).action).toBe('keep');
    expect(decideGuestSignatureRetention(guest, d('2033-03-01')).action).toBe('purge');
  });
});
