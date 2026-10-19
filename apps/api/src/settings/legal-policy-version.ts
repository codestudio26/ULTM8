import type { PrismaClient } from '@prisma/client';

/** The legal document a Guardian's consent refers to (Decision 171). */
export const PRIVACY_NOTICE_SLUG = 'privacy-statement';

/** A consent's `policyVersion`: the slug and version number of the exact text
 * the Guardian was shown, e.g. `privacy-statement@3` (Decision 171). */
export function formatPolicyVersion(slug: string, version: number): string {
  return `${slug}@${version}`;
}

/**
 * The current `policyVersion` for `slug`, or null while nothing has been
 * published (or the published text is empty). A plain function over the client,
 * not a provider: GuardiansModule cannot import a module that imports
 * PlatformAdminModule (PlatformAdmin -> Payments -> Tenants -> Guardians would be
 * a cycle), and LegalDocument has no RLS, so no tenant context is needed — same
 * reasoning as SettingsService.getLegalDocument().
 */
export async function getCurrentPolicyVersion(
  prisma: Pick<PrismaClient, 'legalDocument'>,
  slug: string,
): Promise<string | null> {
  const doc = await prisma.legalDocument.findUnique({
    where: { slug },
    select: { currentVersion: true, content: true },
  });
  if (!doc || doc.currentVersion === null || !doc.content?.trim()) return null;
  return formatPolicyVersion(slug, doc.currentVersion);
}
