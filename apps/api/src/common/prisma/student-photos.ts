import { PrismaJobsService } from './prisma-jobs.service';

/**
 * The photos a School screen may show: a child's (a Student with a Guardian)
 * only while a Guardian's camera consent is active (Decisions 57, 69); an
 * adult's always. The caller has already read each photo under its own
 * access (RLS, or a desk session's own check); this only hides children's
 * photos without consent. The consent read uses the jobs role because staff
 * can't read ConsentRecord, and it is limited to the ids passed in.
 */
export async function photosShownFor(
  prismaJobs: PrismaJobsService,
  students: Array<{ id: string; profilePhotoUrl?: string | null }>,
): Promise<Map<string, string | null>> {
  const withPhoto = students.filter((s) => s.profilePhotoUrl);
  if (withPhoto.length === 0) return new Map();
  const ids = withPhoto.map((s) => s.id);
  const [links, consents] = await Promise.all([
    prismaJobs.guardianLink.findMany({ where: { studentId: { in: ids }, revokedAt: null }, select: { studentId: true } }),
    prismaJobs.consentRecord.findMany({ where: { studentId: { in: ids }, tier: 'CAMERA', status: 'ACTIVE' }, select: { studentId: true } }),
  ]);
  const children = new Set(links.map((l) => l.studentId));
  const consented = new Set(consents.map((c) => c.studentId));
  return new Map(withPhoto.map((s) => [s.id, !children.has(s.id) || consented.has(s.id) ? (s.profilePhotoUrl ?? null) : null]));
}
