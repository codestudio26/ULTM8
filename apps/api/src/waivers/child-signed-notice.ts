import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isAdultOn } from '../common/decorators/is-birth-date.decorator';
import type { NotificationFanoutJobData } from '../jobs/notification-fanout.types';

/** The notice's title; packages/i18n translates it (server.notifications.waiverSignedByChildTitle). */
export const CHILD_SIGNED_TITLE = 'Waiver signed by your child';

/** The notice's body; packages/i18n translates it (BODY_RULES, waiverSignedByChildBody). */
export function childSignedBody(child: string, waiver: string, school: string): string {
  return `${child} signed the waiver "${waiver}" at ${school}.`;
}

/**
 * Decision 435 item 30: when a child signs a waiver themselves (with their own
 * login, or in a parent's app, Decision 318 item 8), each of their active
 * parents is told, through the ordinary notifications channel. "A child" is a
 * Student under 18 on the School's own date, as for a parent's copies of a
 * child's notices (Decision 430 item 7). Sent straight to each parent, as a
 * parent's copy of a notice about the child (`guardianCopyOf`), so it is never
 * copied on again and the child gets nothing. Read on the jobs connection: the
 * signer can't read their parents' links. Best-effort: the signature stands
 * whatever happens here.
 */
export async function notifyParentsChildSigned(
  prismaJobs: PrismaJobsService,
  fanoutQueue: Queue,
  logger: Pick<Logger, 'warn'>,
  signature: { id: string; studentId: string; schoolId: string; waiverId: string; signedWaiverTitle: string | null },
): Promise<number> {
  try {
    const [child, school, waiver, links] = await Promise.all([
      prismaJobs.user.findUnique({ where: { id: signature.studentId }, select: { firstName: true, dateOfBirth: true } }),
      prismaJobs.school.findUnique({ where: { id: signature.schoolId }, select: { name: true, timezone: true } }),
      prismaJobs.waiver.findUnique({ where: { id: signature.waiverId }, select: { title: true } }),
      prismaJobs.guardianLink.findMany({ where: { studentId: signature.studentId, revokedAt: null }, select: { guardianId: true } }),
    ]);
    if (!child || links.length === 0) return 0;
    if (isAdultOn(child.dateOfBirth, new Date(), school?.timezone ?? null)) return 0;
    const body = childSignedBody(child.firstName, signature.signedWaiverTitle ?? waiver?.title ?? '', school?.name ?? '');
    await fanoutQueue.addBulk(
      links.map(({ guardianId }) => {
        const id = `waiver-signed-by-child-${signature.id}-${guardianId}`;
        const data: NotificationFanoutJobData = {
          notificationId: id,
          userId: guardianId,
          title: CHILD_SIGNED_TITLE,
          body,
          type: 'WAIVER_SIGNED_BY_CHILD',
          guardianCopyOf: signature.studentId,
          schoolId: signature.schoolId,
          targetType: 'WAIVER',
          targetId: signature.waiverId,
        };
        return { name: 'notify', data, opts: { jobId: id, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } } };
      }),
    );
    return links.length;
  } catch (err) {
    logger.warn(`Could not tell the parents that a child signed waiver signature ${signature.id}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
