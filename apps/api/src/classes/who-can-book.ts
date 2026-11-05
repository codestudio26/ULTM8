import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';

/**
 * Decision 432 item 14 (stress test round 5, AE-6): an optional "Who can book"
 * on a Class and on a weekly slot. EVERYONE (default), WOMEN or MEN, by the
 * member's recorded gender (User.gender, FEMALE or MALE), and an optional age
 * range in whole years on the Class's own date in its time zone.
 *
 * Checked when a seat is taken or queued for: booking (self, Guardian, Kid
 * Mode, staff, the front desk's walk-in), waitlist join and claim. A staff
 * booking with an overrideReason skips it, as it skips the rank gate. A member
 * with no gender or birth date recorded can't book a class that needs one;
 * staff can add it to their profile or book them with an override.
 */
export type WhoCanBook = { audience: 'EVERYONE' | 'WOMEN' | 'MEN'; minAge: number | null; maxAge: number | null };

export function restrictsWhoCanBook(cls: WhoCanBook): boolean {
  return cls.audience !== 'EVERYONE' || cls.minAge !== null || cls.maxAge !== null;
}

/** A range in order, both ends optional (the database checks the same). */
export function assertAgeRange(minAge: number | null | undefined, maxAge: number | null | undefined): void {
  if (minAge != null && maxAge != null && minAge > maxAge) {
    throw new BadRequestException({ code: 'AGE_RANGE_ORDER', message: 'The youngest age can\'t be above the oldest age.' });
  }
}

/** Whole years old on `onDate` (YYYY-MM-DD), from a `@db.Date` birth date. */
export function ageOn(dateOfBirth: Date, onDate: string): number {
  const birth = dateOfBirth.toISOString().slice(0, 10);
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** The refusal for one member, or null when they may book. Pure. */
export function whoCanBookRefusal(
  cls: WhoCanBook & { startDate: Date },
  zone: string | null,
  member: { gender: string | null; dateOfBirth: Date | null },
): { code: string; message: string } | null {
  if (!restrictsWhoCanBook(cls)) return null;
  if (cls.audience !== 'EVERYONE') {
    const gender = (member.gender ?? '').trim().toUpperCase();
    const wanted = cls.audience === 'WOMEN' ? 'FEMALE' : 'MALE';
    if (gender !== 'FEMALE' && gender !== 'MALE') {
      return { code: 'WHO_CAN_BOOK_GENDER_MISSING', message: `This class is for ${cls.audience === 'WOMEN' ? 'women' : 'men'} only, and no gender is recorded on this member's profile. Ask the School.` };
    }
    if (gender !== wanted) {
      return { code: 'WHO_CAN_BOOK_GENDER', message: `This class is for ${cls.audience === 'WOMEN' ? 'women' : 'men'} only.` };
    }
  }
  if (cls.minAge !== null || cls.maxAge !== null) {
    if (!member.dateOfBirth) {
      return { code: 'WHO_CAN_BOOK_AGE_MISSING', message: 'This class has an age range, and no date of birth is recorded on this member\'s profile. Ask the School.' };
    }
    const z = zone && DateTime.local().setZone(zone).isValid ? zone : 'UTC';
    const age = ageOn(member.dateOfBirth, DateTime.fromJSDate(cls.startDate).setZone(z).toISODate()!);
    if ((cls.minAge !== null && age < cls.minAge) || (cls.maxAge !== null && age > cls.maxAge)) {
      const range = cls.minAge !== null && cls.maxAge !== null ? `${cls.minAge} to ${cls.maxAge}` : cls.minAge !== null ? `${cls.minAge} and over` : `${cls.maxAge} and under`;
      return { code: 'WHO_CAN_BOOK_AGE', message: `This class is for ages ${range}.` };
    }
  }
  return null;
}

type Tx = Pick<Prisma.TransactionClient, 'user' | 'branch' | 'school'>;

/**
 * Refuses a member the Class isn't for. Reads the member's own User row and
 * the Class's zone in the transaction it is given (the member's own context
 * for a booking, so RLS shows exactly their row).
 */
export async function assertWhoCanBook(
  tx: Tx,
  studentId: string,
  cls: WhoCanBook & { startDate: Date; schoolId: string; branchId: string | null },
): Promise<void> {
  if (!restrictsWhoCanBook(cls)) return;
  const member = await tx.user.findUnique({ where: { id: studentId }, select: { gender: true, dateOfBirth: true } });
  let zone: string | null = null;
  if (cls.minAge !== null || cls.maxAge !== null) {
    const branch = cls.branchId ? await tx.branch.findUnique({ where: { id: cls.branchId }, select: { timezone: true } }) : null;
    const school = branch?.timezone ? null : await tx.school.findUnique({ where: { id: cls.schoolId }, select: { timezone: true } });
    zone = branch?.timezone || school?.timezone || null;
  }
  const refusal = whoCanBookRefusal(cls, zone, { gender: member?.gender ?? null, dateOfBirth: member?.dateOfBirth ?? null });
  if (refusal) {
    throw new ForbiddenException({ code: refusal.code, message: `${refusal.message} A member of staff can book them with an override reason.` });
  }
}
