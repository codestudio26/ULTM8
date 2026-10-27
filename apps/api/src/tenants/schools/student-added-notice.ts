import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { NotificationFanoutJobData } from '../../jobs/notification-fanout.types';

/**
 * Decision 366 (Students Q5) — when the School owner adds a student (Invite or
 * Re-enrol), the student hears "You've been added to [School]".
 * There is no accept step: the enrolment already happened. (Add manually
 * sends none: its email already says so.) A child's active
 * Guardians get the usual "For [child]: …" copy from NotificationFanoutProcessor.
 *
 * The School's name is read on the jobs connection, after the enrolment
 * commits. One notice per enrolment (the RoleGrant id is in its id), so a
 * retry never doubles it. Best-effort, like the Franchise notices: a queue
 * failure is logged, never a reason to fail the enrolment.
 */
export async function sendStudentAddedNotice(
  queue: Queue,
  prismaJobs: PrismaJobsService,
  logger: Logger,
  notice: { roleGrantId: string; schoolId: string; studentId: string },
): Promise<void> {
  try {
    const school = await prismaJobs.school.findUnique({ where: { id: notice.schoolId }, select: { name: true } });
    if (!school) return;
    const id = `student-added-${notice.roleGrantId}`;
    const data: NotificationFanoutJobData = {
      notificationId: id,
      userId: notice.studentId,
      title: 'Added to a School',
      body: `You've been added to ${school.name}.`,
      type: 'STUDENT_ADDED',
      schoolId: notice.schoolId,
    };
    await queue.add('notify', data, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  } catch (err) {
    logger.warn(`Failed to send the added-to-School notice for Student ${notice.studentId} at School ${notice.schoolId}: ${err}`);
  }
}
