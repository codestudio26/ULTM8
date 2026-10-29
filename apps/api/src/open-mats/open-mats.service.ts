import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { OPEN_MAT_CLASS_TYPE } from '../ranks/hours-trained';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { StartOpenMatDto } from './dto/open-mat.dto';

const STAFF_ROLES = ['BRANCH_STAFF', 'INSTRUCTOR'] as const;
const DEFAULT_MINUTES = 60;
// How far from now an unplanned session may start (this build's choice, Decision 386).
const EARLIEST_START_MS = 30 * 60_000;
const LATEST_START_MS = 24 * 60 * 60_000;

/**
 * Unplanned open mat sessions (Decision 304 items 1, 4, 5; built as Decision
 * 386, front-desk handover F10). "+ Open mat session" on the Check-in page
 * makes a one-off Class with the class type "Open mat", so booking, check-in,
 * attendance and hours work as for any class. The School owner can always
 * start one; Branch Staff and coaches only with the owner's per-person "Can
 * start open mat sessions" switch, at their own Branches. Students with a
 * live membership whose home Branch is that Branch and who train that style
 * are told in the app (in-app only: push waits for "Open mat alerts" and the
 * Firebase/APNs credentials, Decision 267).
 */
@Injectable()
export class OpenMatsService {
  private readonly logger = new Logger(OpenMatsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly subscriptionGate: SubscriptionGateService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  /** GET /schools/{schoolId}/open-mats/me: whether the caller can start one,
   * and where (null: anywhere). */
  async mine(callerId: string, schoolId: string): Promise<{ canStart: boolean; branchIds: string[] | null }> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    if (await this.tenantAuth.isSchoolOwner(callerId, schoolId)) return { canStart: true, branchIds: null };
    const { grants, permission } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({
        where: { userId: callerId, schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null },
        select: { branchId: true },
      }),
      permission: await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { canStartOpenMat: true } }),
    }));
    if (!permission?.canStartOpenMat || grants.length === 0) return { canStart: false, branchIds: [] };
    if (grants.some((g) => g.branchId === null)) return { canStart: true, branchIds: null };
    return { canStart: true, branchIds: [...new Set(grants.map((g) => g.branchId as string))] };
  }

  /** POST /schools/{schoolId}/open-mats. */
  async start(callerId: string, schoolId: string, dto: StartOpenMatDto) {
    const branchId = dto.branchId ?? null;
    const disciplineId = dto.disciplineId ?? null;
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);

    const branches = await this.prismaJobs.branch.findMany({ where: { schoolId, archivedAt: null }, select: { id: true, name: true, timezone: true } });
    if (branches.length > 0 && !branches.some((b) => b.id === branchId)) {
      throw new BadRequestException("Pick one of the School's open Branches for this open mat.");
    }
    if (branches.length === 0 && branchId) {
      throw new BadRequestException('This School has no Branches: start the open mat for the whole School.');
    }
    const may = await this.mine(callerId, schoolId);
    if (!may.canStart) {
      throw new ForbiddenException({ code: 'CANNOT_START_OPEN_MAT', message: 'Only the School owner, and staff the owner allows, can start an open mat.' });
    }
    if (may.branchIds && !may.branchIds.includes(branchId as string)) {
      throw new ForbiddenException({ code: 'CANNOT_START_OPEN_MAT', message: 'You can start an open mat only at your own Branches.' });
    }

    const disciplines = await this.prismaJobs.discipline.findMany({ where: { schoolId }, select: { id: true, name: true, archivedAt: true } });
    const live = disciplines.filter((d) => !d.archivedAt);
    const style = disciplineId ? live.find((d) => d.id === disciplineId) : null;
    if (live.length > 0 && !style) {
      throw new BadRequestException("Pick one of the School's styles for this open mat.");
    }
    if (live.length === 0 && disciplineId) {
      throw new BadRequestException('This School has no styles yet, so a class cannot be given one.');
    }

    const startDate = new Date(dto.startsAt);
    const now = Date.now();
    if (startDate.getTime() < now - EARLIEST_START_MS || startDate.getTime() > now + LATEST_START_MS) {
      throw new BadRequestException('An open mat starts from 30 minutes ago to 24 hours ahead.');
    }
    const minutes = dto.minutes ?? DEFAULT_MINUTES;
    const endDate = new Date(startDate.getTime() + minutes * 60_000);

    const cls = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.create({
        data: {
          id: randomUUID(),
          schoolId,
          branchId,
          title: OPEN_MAT_CLASS_TYPE,
          activities: style ? [style.name] : [OPEN_MAT_CLASS_TYPE],
          // The class type marks it as open mat for hours (Decision 304 item 1),
          // whether or not the style lists "Open mat" among its types.
          styles: style ? [{ disciplineId: style.id, classType: OPEN_MAT_CLASS_TYPE }] : [],
          startDate,
          endDate,
          capacity: null,
          membershipInclusion: true,
        },
      }),
    );

    const notified = await this.tellStudents({
      schoolId,
      classId: cls.id,
      branchId,
      disciplineId: style?.id ?? null,
      styleName: style?.name ?? null,
      branch: branches.find((b) => b.id === branchId) ?? null,
      startDate,
      minutes,
    });
    return { classId: cls.id, title: cls.title, branchId: cls.branchId, startDate: cls.startDate.toISOString(), endDate: cls.endDate.toISOString(), notified };
  }

  /** GET /schools/{schoolId}/open-mats/permissions: Branch Staff and coaches,
   * and whether each can start one. Owner only. */
  async listPermissions(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const { grants, permissions } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({ where: { schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null }, select: { userId: true, role: true } }),
      permissions: await tx.staffPermission.findMany({ where: { schoolId }, select: { userId: true, canStartOpenMat: true } }),
    }));
    const roles = new Map<string, Set<'BRANCH_STAFF' | 'INSTRUCTOR'>>();
    for (const g of grants) roles.set(g.userId, (roles.get(g.userId) ?? new Set()).add(g.role as 'BRANCH_STAFF' | 'INSTRUCTOR'));
    // The owner always can, so they aren't listed.
    for (const id of [...roles.keys()]) if (await this.tenantAuth.isSchoolOwner(id, schoolId)) roles.delete(id);
    const names = await resolveUserNames(this.prismaAuth, [...roles.keys()]);
    const allowed = new Map(permissions.map((p) => [p.userId, p.canStartOpenMat]));
    const items = [...roles.entries()].map(([userId, r]) => ({
      userId,
      firstName: names.get(userId)?.firstName ?? '',
      surname: names.get(userId)?.surname ?? '',
      roles: [...r].sort(),
      canStartOpenMat: allowed.get(userId) ?? false,
    }));
    items.sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`));
    return { items };
  }

  /** PUT /schools/{schoolId}/open-mats/permissions/{userId}. Owner only;
   * Branch Staff and coaches only. */
  async setPermission(callerId: string, schoolId: string, userId: string, canStartOpenMat: boolean) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const isStaff = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId, schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null }, select: { id: true } }),
    );
    if (!isStaff) throw new BadRequestException('"Can start open mat sessions" is for Branch Staff and coaches at this School.');
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.staffPermission.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, canStartOpenMat, grantedById: callerId },
        update: { canStartOpenMat, grantedById: callerId },
      }),
    );
    return (await this.listPermissions(callerId, schoolId)).items.find((i) => i.userId === userId)!;
  }

  /** Decision 304 item 5: students with a live membership here, whose home
   * Branch is this one, and who train this style (hold a rank in it), hear
   * about it in their Notifications. */
  private async tellStudents(o: {
    schoolId: string;
    classId: string;
    branchId: string | null;
    disciplineId: string | null;
    styleName: string | null;
    branch: { name: string; timezone: string | null } | null;
    startDate: Date;
    minutes: number;
  }): Promise<number> {
    // Read via ultm8_jobs: whoever started it may not see every student.
    const students = await this.prismaJobs.roleGrant.findMany({ where: { schoolId: o.schoolId, role: 'STUDENT', revokedAt: null }, select: { userId: true } });
    let ids = [...new Set(students.map((s) => s.userId))];
    if (o.branchId && ids.length > 0) {
      const home = await this.prismaJobs.studentHomeBranch.findMany({
        where: { schoolId: o.schoolId, branchId: o.branchId, studentId: { in: ids } },
        select: { studentId: true },
      });
      ids = home.map((h) => h.studentId);
    }
    if (o.disciplineId && ids.length > 0) {
      const ranked = await this.prismaJobs.studentRank.findMany({
        where: { disciplineId: o.disciplineId, studentId: { in: ids } },
        select: { studentId: true },
      });
      ids = [...new Set(ranked.map((r) => r.studentId))];
    }
    if (ids.length === 0) return 0;
    const memberships = await this.prismaJobs.membership.findMany({
      where: { schoolId: o.schoolId, studentId: { in: ids } },
      select: { studentId: true, status: true, expiryDate: true, classesRemaining: true },
    });
    const now = new Date();
    const recipients = [...new Set(memberships.filter((m) => isMembershipLive(m, now)).map((m) => m.studentId))];
    if (recipients.length === 0) return 0;

    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: o.schoolId }, select: { name: true, timezone: true } });
    const zone = o.branch?.timezone ?? school.timezone ?? 'UTC';
    const when = DateTime.fromJSDate(o.startDate).setZone(zone).toFormat("cccc d LLL 'at' HH:mm");
    const place = o.branch?.name ?? school.name;
    const body = `Open mat${o.styleName ? ` (${o.styleName})` : ''} at ${place} on ${when}, for ${o.minutes} minutes. Book in the app to join.`;
    for (const userId of recipients) {
      const id = `open-mat-${o.classId}-${userId}`;
      try {
        const data: NotificationFanoutJobData = {
          notificationId: id,
          userId,
          title: 'Open mat',
          body,
          type: 'OPEN_MAT',
          schoolId: o.schoolId,
          targetType: 'CLASS',
          targetId: o.classId,
          inAppOnly: true,
        };
        await this.fanoutQueue.add('notify', data, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      } catch (err) {
        this.logger.warn(`Failed to enqueue the open mat notification for ${userId}: ${err}`);
      }
    }
    return recipients.length;
  }
}
