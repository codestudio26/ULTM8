import type { Logger } from '@nestjs/common';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import type { R2ClientService } from '../common/object-storage/r2-client.service';
import { memberFileExtension, type MemberFileContentType } from '../member-files/member-file-type';
import type { ZipFileWriter } from './zip-file-writer';

/** Member files read from the database at a time. */
const PAGE = 200;

/** The folder in the ZIP that holds the member files. */
export const MEMBER_FILES_FOLDER = 'member-files';

/** Windows will not open a file or folder with one of these names. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * One part of a path in the ZIP, safe on every system: no slashes or other
 * characters Windows or macOS refuse, no control or text-direction
 * characters (which can disguise an extension), never "." or "..", no
 * leading or trailing dots or spaces, not a reserved Windows name, and at
 * most `max` characters with the extension kept. Empty becomes "_".
 */
export function safePathPart(raw: string, max: number): string {
  let s = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (s.length > max) {
    const dot = s.lastIndexOf('.');
    const extension = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, max - extension.length).replace(/[\s.]+$/, '') + extension;
  }
  if (!s) return '_';
  return RESERVED.test(s) ? `_${s}` : s;
}

/** The member's folder: their name and the start of their id, so two
 * members with the same name never share one. */
export function memberFolderName(memberName: string, studentId: string): string {
  return `${safePathPart(memberName, 80)}-${studentId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8)}`;
}

/** The file's name in the ZIP: its uploaded name made safe, ending in the
 * extension of its type (checked from its content when it was uploaded). */
export function memberFileZipName(fileName: string, contentType: string): string {
  let name = safePathPart(fileName, 120);
  const extension = memberFileExtension(contentType as MemberFileContentType);
  const lower = name.toLowerCase();
  const fits = lower.endsWith(`.${extension}`) || (extension === 'jpg' && lower.endsWith('.jpeg'));
  if (!fits && extension) name = `${name}.${extension}`;
  return name;
}

/** `name` unless `taken` already has it (ignoring case, as Windows and macOS
 * do); otherwise "name (2).ext", "name (3).ext", and so on. Adds the result
 * to `taken`. */
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${extension}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Adds every member file at the School to the export's ZIP (Decision 422
 * item 9), the files on members' Profile → Documents, as
 * `member-files/<member name>-<short id>/<file name>`. Reads on the jobs
 * connection, for this School only, and only files still on a member:
 * Profile → Documents lists a member's files by School and member, and a
 * file whose member's account was erased (no member any more) is waiting to
 * be purged and is on no one's profile. Deleting a file removes its row, so
 * a deleted file is never here. Each file is streamed from storage into the
 * ZIP, so none is held in memory whole. A file missing from storage is left
 * out and logged.
 */
export async function addMemberFilesToZip(
  prismaJobs: PrismaJobsService,
  r2: Pick<R2ClientService, 'getObjectStream'>,
  schoolId: string,
  zip: ZipFileWriter,
  logger: Pick<Logger, 'warn'>,
): Promise<{ fileCount: number; missingCount: number }> {
  const folders = new Map<string, string>();
  const foldersTaken = new Set<string>();
  const namesTaken = new Map<string, Set<string>>();
  let fileCount = 0;
  let missingCount = 0;

  let cursor: string | undefined;
  for (;;) {
    const rows = await prismaJobs.memberFile.findMany({
      where: { schoolId, studentId: { not: null } },
      orderBy: [{ studentId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, studentId: true, fileName: true, contentType: true, sizeBytes: true, objectKey: true, createdAt: true },
    });
    if (rows.length === 0) break;

    const missing = [...new Set(rows.map((r) => r.studentId as string).filter((id) => !folders.has(id)))];
    if (missing.length > 0) {
      const users = await prismaJobs.user.findMany({ where: { id: { in: missing } }, select: { id: true, firstName: true, surname: true } });
      const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.surname}`.trim()]));
      for (const id of missing) {
        let folder = memberFolderName(names.get(id) ?? '', id);
        // Two members whose names and id starts both match get the full id.
        if (foldersTaken.has(folder.toLowerCase())) folder = `${safePathPart(names.get(id) ?? '', 80)}-${id}`;
        foldersTaken.add(folder.toLowerCase());
        folders.set(id, folder);
        namesTaken.set(id, new Set());
      }
    }

    for (const r of rows) {
      const studentId = r.studentId as string;
      const source = await r2.getObjectStream(r.objectKey);
      if (!source) {
        missingCount += 1;
        logger.warn(`signed-documents-export: member file ${r.id} of School ${schoolId} is missing from storage and was left out.`);
        continue;
      }
      const name = uniqueName(memberFileZipName(r.fileName, r.contentType), namesTaken.get(studentId) as Set<string>);
      await zip.addStream(`${MEMBER_FILES_FOLDER}/${folders.get(studentId)}/${name}`, source, r.createdAt, r.sizeBytes);
      fileCount += 1;
    }
    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return { fileCount, missingCount };
}
