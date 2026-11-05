import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GUARDIAN_MANAGED_EMAIL_DOMAIN } from '../../guardians/guardians.service';

type Reader = Pick<PrismaClient, 'user' | 'roleGrant' | 'guardianLink'>;

/** The fields that say who a person is, shared by every School they belong to. */
export const IDENTITY_FIELDS = ['firstName', 'surname', 'dateOfBirth', 'gender'] as const;
type IdentityField = (typeof IDENTITY_FIELDS)[number];

type Identity = { firstName: string; surname: string; dateOfBirth: Date | string | null; gender: string | null };

/** The identity fields `change` actually changes from `current`. */
export function changedIdentityFields(current: Identity, change: Partial<Record<IdentityField, unknown>>): IdentityField[] {
  return IDENTITY_FIELDS.filter((field) => {
    const next = change[field];
    if (next === undefined) return false;
    const now = current[field];
    if (field === 'dateOfBirth') {
      const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
      return day(next) !== day(now);
    }
    if (field === 'firstName' || field === 'surname') return String(next ?? '').trim() !== String(now ?? '').trim();
    return (next ?? null) !== (now ?? null);
  });
}

/** Someone who can sign in on their own and has done so: a real email, a
 * chosen passcode (not a School's temporary one) and, where they have a
 * phone, a verified one. */
function signedIn(u: { email: string; mustChangePasscode: boolean; phone: string | null; phoneVerifiedAt: Date | null }): boolean {
  return !u.email.toLowerCase().endsWith(`@${GUARDIAN_MANAGED_EMAIL_DOMAIN}`) && !u.mustChangePasscode && (!u.phone || !!u.phoneVerifiedAt);
}

/**
 * Decision 429 item 13 (PRIV-2, narrows Decision 341 item 1): a member's
 * name, date of birth and gender live on their one User row, which every
 * School they belong to reads. Staff of one School may change them only while
 * the person is theirs alone: 409 IDENTITY_SHARED when the person holds a
 * live STUDENT role at another School, or has their own login and has signed
 * in, or is a child whose parent or guardian has signed in. They (or their
 * parent) change it in the app instead. Contacts and other details are not
 * locked. Read on the jobs and auth connections after the caller's access
 * check.
 */
export async function assertIdentityNotShared(
  jobs: Pick<PrismaClient, 'roleGrant' | 'guardianLink'>,
  auth: Pick<Reader, 'user'>,
  schoolId: string,
  studentId: string,
): Promise<void> {
  const elsewhere = await jobs.roleGrant.findFirst({
    where: { userId: studentId, role: 'STUDENT', revokedAt: null, schoolId: { not: schoolId } },
    select: { id: true },
  });
  const links = elsewhere ? [] : await jobs.guardianLink.findMany({ where: { studentId, revokedAt: null }, select: { guardianId: true } });
  const people = elsewhere
    ? []
    : await auth.user.findMany({
        where: { id: { in: [studentId, ...links.map((l) => l.guardianId)] } },
        select: { id: true, email: true, mustChangePasscode: true, phone: true, phoneVerifiedAt: true },
      });
  if (elsewhere || people.some(signedIn)) {
    throw new ConflictException({
      code: 'IDENTITY_SHARED',
      message:
        "This person's name, date of birth and gender are shared with another School or with their own account, so only they (or their parent or guardian) can change them, in the ULTM8 app.",
    });
  }
}
