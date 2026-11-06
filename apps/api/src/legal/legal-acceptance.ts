import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Decision 440 — the legal pages (LegalDocument slugs) and how an acceptance is
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
 * saved with (Decision 440, C5). */
export async function childrenNoticeVersion(db: Db): Promise<string> {
  return (await currentLegalVersions(db, [LEGAL_SLUGS.childrenNotice]))[LEGAL_SLUGS.childrenNotice]!;
}

/** Records that `userId` accepted each page, at its current version. Must run
 * inside the user's own tenant context (LegalAcceptance is self-only RLS). */
export async function recordLegalAcceptances(
  tx: Pick<Prisma.TransactionClient, 'legalDocument' | 'legalAcceptance'>,
  userId: string,
  slugs: readonly LegalSlug[],
  scope: { schoolId?: string; franchiseId?: string } = {},
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
      acceptedAt,
    })),
  });
}

/** Decision 440: creating a School or Franchise needs the owner's tick on the
 * School and Franchise Agreement (with its Data Processing Addendum). */
export function assertAgreementAccepted(accepted: boolean | undefined): void {
  if (accepted !== true) {
    throw new BadRequestException({ code: 'AGREEMENT_NOT_ACCEPTED', message: 'Accept the School and Franchise Agreement to continue.' });
  }
}
