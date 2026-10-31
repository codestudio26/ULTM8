import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import type { R2ClientService } from '../common/object-storage/r2-client.service';
import { SIGNED_DOCUMENT_LABEL_DEFAULTS, type SignedDocumentLabels } from './dto/signed-documents.dto';
import { documentFileName, imageTypeOf, indexCsv, signedDocumentHtml, type SignedDocument } from './signed-document-render';
import { ZipWriter } from './zip-writer';

/** Signatures read from the database at a time. */
const PAGE = 200;

/** The labels to use: the portal's, with English for any left out. */
export function labelsFrom(stored: unknown): SignedDocumentLabels {
  const given = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const labels = { ...SIGNED_DOCUMENT_LABEL_DEFAULTS } as SignedDocumentLabels;
  for (const key of Object.keys(labels) as Array<keyof SignedDocumentLabels>) {
    const v = given[key];
    if (typeof v === 'string' && v.trim()) labels[key] = v.trim();
  }
  return labels;
}

/**
 * Builds the ZIP of every signed document at a School (Decision 315 item
 * 13): one HTML document per signature (members' waivers, including ones
 * that have since expired, and guests' waivers), with the drawn signature or
 * paper photo inside it, and index.csv listing them all. Reads on the jobs
 * connection, for this School only. Unsigned rows are not documents and are
 * left out.
 */
export async function buildSignedDocumentsZip(
  prismaJobs: PrismaJobsService,
  r2: Pick<R2ClientService, 'getObject' | 'isConfigured'>,
  schoolId: string,
  labels: SignedDocumentLabels,
): Promise<{ zip: Buffer; documentCount: number }> {
  const school = await prismaJobs.school.findUnique({ where: { id: schoolId }, select: { name: true } });
  const schoolName = school?.name ?? '';
  const zip = new ZipWriter();
  const index: Array<{ doc: SignedDocument; file: string }> = [];
  const add = (doc: SignedDocument) => {
    const file = documentFileName(index.length + 1, doc);
    zip.add(file, signedDocumentHtml(doc, schoolName, labels), doc.signedAt);
    index.push({ doc, file });
  };

  const names = new Map<string, string>();
  const nameOf = async (ids: Array<string | null>) => {
    const missing = [...new Set(ids.filter((id): id is string => !!id && !names.has(id)))];
    if (missing.length === 0) return;
    const users = await prismaJobs.user.findMany({ where: { id: { in: missing } }, select: { id: true, firstName: true, surname: true } });
    for (const u of users) names.set(u.id, `${u.firstName} ${u.surname}`.trim());
  };

  const imageOf = async (key: string | null): Promise<Pick<SignedDocument, 'image' | 'imageMissing'>> => {
    if (!key) return { image: null, imageMissing: false };
    const bytes = r2.isConfigured() ? await r2.getObject(key) : null;
    const contentType = bytes ? imageTypeOf(bytes) : null;
    return bytes && contentType ? { image: { bytes, contentType }, imageMissing: false } : { image: null, imageMissing: true };
  };

  // Members' signatures, oldest first.
  let cursor: string | undefined;
  for (;;) {
    const rows = await prismaJobs.waiverSignature.findMany({
      where: { schoolId, signedDate: { not: null } },
      orderBy: [{ signedDate: 'asc' }, { id: 'asc' }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        studentId: true,
        signedById: true,
        recordedById: true,
        signerFullName: true,
        signatureText: true,
        signatureImageKey: true,
        signedDate: true,
        status: true,
        method: true,
        signedWaiverTitle: true,
        signedWaiverBody: true,
        signedWaiverSha256: true,
        signedWaiverVersion: true,
        waiver: { select: { title: true } },
      },
    });
    if (rows.length === 0) break;
    await nameOf(rows.flatMap((r) => [r.studentId, r.signedById, r.recordedById]));
    for (const r of rows) {
      add({
        id: r.id,
        kind: 'MEMBER',
        memberName: names.get(r.studentId) ?? '',
        title: r.signedWaiverTitle ?? r.waiver.title,
        version: r.signedWaiverVersion,
        body: r.signedWaiverBody,
        sha256: r.signedWaiverSha256,
        signedAt: r.signedDate as Date,
        signerName: r.signerFullName ?? '',
        signatureText: r.signatureText,
        byGuardian: r.signedById !== null && r.signedById !== r.studentId,
        onPaper: r.method === 'PAPER',
        recordedByName: r.recordedById ? names.get(r.recordedById) ?? null : null,
        expired: r.status === 'EXPIRED',
        ...(await imageOf(r.signatureImageKey)),
      });
    }
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].id;
  }

  // Guests' signatures (Decision 351), oldest first.
  cursor = undefined;
  for (;;) {
    const rows = await prismaJobs.guestWaiverSignature.findMany({
      where: { schoolId },
      orderBy: [{ signedAt: 'asc' }, { id: 'asc' }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        guestFullName: true,
        signerFullName: true,
        signatureText: true,
        signedByGuardian: true,
        signedWaiverTitle: true,
        signedWaiverBody: true,
        signedWaiverSha256: true,
        signedWaiverVersion: true,
        signedAt: true,
      },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      add({
        id: r.id,
        kind: 'GUEST',
        memberName: r.guestFullName,
        title: r.signedWaiverTitle,
        version: r.signedWaiverVersion,
        body: r.signedWaiverBody,
        sha256: r.signedWaiverSha256,
        signedAt: r.signedAt,
        signerName: r.signerFullName,
        signatureText: r.signatureText,
        byGuardian: r.signedByGuardian,
        onPaper: false,
        recordedByName: null,
        expired: false,
        image: null,
        imageMissing: false,
      });
    }
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].id;
  }

  zip.add('index.csv', indexCsv(index, labels));
  return { zip: zip.finish(), documentCount: index.length };
}
