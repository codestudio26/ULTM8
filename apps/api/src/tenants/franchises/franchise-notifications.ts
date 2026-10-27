import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { NotificationFanoutJobData, NotificationTargetType } from '../../jobs/notification-fanout.types';

/**
 * Decision 364 — in-app notices for Franchise membership (email and push follow
 * the fanout job once those go live):
 * - a School asks to join → the Franchise's Owners;
 * - accepted, declined, removed, or the Franchise closed → the School's Owners.
 *
 * Owners are read on the jobs connection: neither side can see the other's
 * RoleGrants. Each notice has a deterministic id per event and person, so a
 * retry never doubles it. Best-effort: a queue failure is logged, never a
 * reason to fail the action it reports.
 */
export type FranchiseNotice =
  | { kind: 'ASKED'; requestId: string; franchiseId: string; franchiseName: string; schoolId: string; schoolName: string }
  | { kind: 'ACCEPTED' | 'DECLINED'; requestId: string; franchiseName: string; schoolId: string; schoolName: string }
  | { kind: 'REMOVED' | 'FRANCHISE_CLOSED'; franchiseId: string; franchiseName: string; schoolId: string; schoolName: string };

export async function sendFranchiseNotice(queue: Queue, prismaJobs: PrismaJobsService, logger: Logger, notice: FranchiseNotice): Promise<void> {
  try {
    const toFranchise = notice.kind === 'ASKED';
    const grants = await prismaJobs.roleGrant.findMany({
      where: toFranchise
        ? { role: 'FRANCHISE_OWNER', franchiseId: notice.franchiseId, revokedAt: null }
        : { role: 'SCHOOL_OWNER_MANAGER', schoolId: notice.schoolId, revokedAt: null },
      select: { userId: true },
    });
    const { key, title, body, targetType, targetId } = describe(notice);
    const userIds = [...new Set(grants.map((g) => g.userId))];
    if (userIds.length === 0) return;
    await queue.addBulk(
      userIds.map((userId) => {
        const id = `${key}-${userId}`;
        const data: NotificationFanoutJobData = { notificationId: id, userId, title, body, type: `FRANCHISE_${notice.kind}`, schoolId: notice.schoolId, targetType, targetId };
        return { name: 'notify', data, opts: { jobId: id, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } } };
      }),
    );
  } catch (err) {
    logger.warn(`Failed to send the Franchise notice ${notice.kind} for School ${notice.schoolId}: ${err}`);
  }
}

function describe(notice: FranchiseNotice): { key: string; title: string; body: string; targetType: NotificationTargetType; targetId: string } {
  const { franchiseName: franchise, schoolName: school, schoolId } = notice;
  switch (notice.kind) {
    case 'ASKED':
      return {
        key: `franchise-join-asked-${notice.requestId}`,
        title: 'School asking to join',
        body: `${school} has asked to join ${franchise}.`,
        targetType: 'FRANCHISE',
        targetId: notice.franchiseId,
      };
    case 'ACCEPTED':
      return { key: `franchise-join-accepted-${notice.requestId}`, title: 'Joined the Franchise', body: `${franchise} accepted ${school}'s request to join.`, targetType: 'SCHOOL', targetId: schoolId };
    case 'DECLINED':
      return {
        key: `franchise-join-declined-${notice.requestId}`,
        title: 'Request to join declined',
        body: `${franchise} declined ${school}'s request to join. You can ask again.`,
        targetType: 'SCHOOL',
        targetId: schoolId,
      };
    case 'REMOVED':
      return {
        key: `franchise-removed-${notice.franchiseId}-${schoolId}-${Date.now()}`,
        title: 'Removed from the Franchise',
        body: `${franchise} removed ${school} from the Franchise. Its franchise fees have stopped.`,
        targetType: 'SCHOOL',
        targetId: schoolId,
      };
    case 'FRANCHISE_CLOSED':
      return {
        key: `franchise-closed-${notice.franchiseId}-${schoolId}`,
        title: 'Franchise closed',
        body: `${franchise} has been closed. ${school} stays open, and its franchise fees have stopped.`,
        targetType: 'SCHOOL',
        targetId: schoolId,
      };
  }
}

/** The member Schools to tell when a Franchise closes. Read before anything changes. */
export function memberSchoolsOf(prismaJobs: PrismaJobsService, franchiseId: string) {
  return prismaJobs.school.findMany({ where: { franchiseId, archivedAt: null }, select: { id: true, name: true } });
}
