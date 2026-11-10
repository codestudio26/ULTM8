import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Decision 444 — the legal pages (LegalDocument slugs) and how an acceptance is
 * recorded. Each LegalAcceptance row copies the page's version at the moment it
 * was accepted, so a later version never rewrites what someone agreed to.
 */
export const LEGAL_SLUGS = {
  terms: 'terms-and-conditions',
  privacy: 'privacy-statement',
  schoolAgreement: 'school-agreement',
  childrenNotice: 'children-notice',
  cookies: 'cookie-notice',
} as const;

export type LegalSlug = (typeof LEGAL_SLUGS)[keyof typeof LEGAL_SLUGS];

/** Used when a page's row is missing, so an acceptance is still recorded. */
export const UNPUBLISHED_VERSION = 'unpublished';

type Db = Pick<Prisma.TransactionClient, 'legalDocument'>;

/** The current version of each page. LegalDocument has no RLS, so any client
 * (a tenant transaction or the bare one) can read it. */
export async function currentLegalVersions(db: Db, slugs: readonly LegalSlug[]): Promise<Record<string, string>> {
  const rows = await db.legalDocument.findMany({ where: { slug: { in: [...slugs] } }, select: { slug: true, version: true } });
  const found = new Map(rows.map((r) => [r.slug, r.version]));
  return Object.fromEntries(slugs.map((slug) => [slug, found.get(slug) ?? UNPUBLISHED_VERSION]));
}

/** The Children and Guardians Privacy Notice version a Guardian consent is
 * saved with (Decision 444, C5). */
export async function childrenNoticeVersion(db: Db): Promise<string> {
  return (await currentLegalVersions(db, [LEGAL_SLUGS.childrenNotice]))[LEGAL_SLUGS.childrenNotice]!;
}

/** Records that `userId` accepted each page, at its current version. Must run
 * inside the user's own tenant context (LegalAcceptance is self-only RLS). */
export async function recordLegalAcceptances(
  tx: Pick<Prisma.TransactionClient, 'legalDocument' | 'legalAcceptance'>,
  userId: string,
  slugs: readonly LegalSlug[],
  scope: { schoolId?: string; franchiseId?: string; atFirstSignIn?: boolean } = {},
): Promise<void> {
  const versions = await currentLegalVersions(tx, slugs);
  const acceptedAt = new Date();
  await tx.legalAcceptance.createMany({
    data: slugs.map((slug) => ({
      id: randomUUID(),
      userId,
      documentSlug: slug,
      version: versions[slug]!,
      schoolId: scope.schoolId ?? null,
      franchiseId: scope.franchiseId ?? null,
      atFirstSignIn: scope.atFirstSignIn ?? false,
      acceptedAt,
    })),
  });
}

/** Decision 444: creating a School or Franchise needs the owner's tick on the
 * School and Franchise Agreement (with its Data Processing Addendum). */
export function assertAgreementAccepted(accepted: boolean | undefined): void {
  if (accepted !== true) {
    throw new BadRequestException({ code: 'AGREEMENT_NOT_ACCEPTED', message: 'Accept the School and Franchise Agreement to continue.' });
  }
}

/** Decision 446 item 8: whether `userId` made their own account (sign-up
 * records the Terms acceptance, with no School or Franchise; the first-sign-in
 * acceptance of an account the School made is marked atFirstSignIn and
 * doesn't count, Decision 448 item 8). Decision 449 item 13: an account made
 * by approving a front-desk tablet sign-up (User.signedUpOnTabletAt) counts
 * too. Read in the user's own tenant context. Mirrors the SQL function
 * self_signed_up_users, which the waiver-renewal sweep uses. */
export async function signedUpThemselves(db: Pick<Prisma.TransactionClient, 'legalAcceptance' | 'user'>, userId: string): Promise<boolean> {
  const row = await db.legalAcceptance.findFirst({
    where: { userId, documentSlug: LEGAL_SLUGS.terms, schoolId: null, franchiseId: null, atFirstSignIn: false },
    select: { id: true },
  });
  if (row) return true;
  const user = await db.user.findUnique({ where: { id: userId }, select: { signedUpOnTabletAt: true } });
  return !!user?.signedUpOnTabletAt;
}

/** What someone ticks at sign-up, and at their first sign-in when they didn't
 * sign up themselves (Decision 444 item 1, Decision 448 item 8). */
export const ACCOUNT_LEGAL_SLUGS = [LEGAL_SLUGS.terms, LEGAL_SLUGS.privacy] as const;

/** Decision 448 item 8: true while `userId` has never accepted the Terms for
 * their own account (no Terms acceptance with no School or Franchise): an
 * account the School created (added manually, a tablet sign-up, an import, a
 * Guardian added by staff), and anyone who signed up before the "I agree"
 * tick existed. They are asked once, at their next sign-in. Read in the
 * user's own tenant context (LegalAcceptance is self-only). */
export async function legalAcceptancePending(db: Pick<Prisma.TransactionClient, 'legalAcceptance'>, userId: string): Promise<boolean> {
  const row = await db.legalAcceptance.findFirst({
    where: { userId, documentSlug: LEGAL_SLUGS.terms, schoolId: null, franchiseId: null },
    select: { id: true },
  });
  return !row;
}
