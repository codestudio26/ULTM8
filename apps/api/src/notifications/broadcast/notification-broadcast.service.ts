import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { decodeDescCursor, encodeDescCursor, resolveLimit } from '../../common/pagination/cursor-paginate';
import { TenantAuthorizationService } from '../../tenants/tenant-authorization.service';
import { SchoolsService } from '../../tenants/schools/schools.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../../jobs/queue.constants';
import { BULK_NOTIFICATION_PRIORITY, NotificationFanoutJobData } from '../../jobs/notification-fanout.types';
import { BroadcastAudienceDto, BroadcastClassAudienceDto, BroadcastNotificationDto } from './dto/broadcast-notification.dto';

/**
 * POST /schools/{schoolId}/notifications/broadcast — the one gap the
 * "Notifications page" v1.2 backend backlog entry flagged as this session's
 * "single biggest gap of any page": no endpoint anywhere for a School Owner/
 * Staff member to author and send a Notification. Every real Notification
 * row before this was written only by notification-fanout, itself only ever
 * triggered by three system events (Waiver assigned, payment dispute,
 * chargeback-pattern restriction) — never a direct API call. The product
 * owner approved exactly this: School-Owner-gated, three audience scopes
 * (All Students / one Branch / one Class's roster), enqueued through the
 * EXISTING notification-fanout queue — no second delivery path.
 *
 * School-Owner-gated — same `assertSchoolOwner` gate Waiver/MembershipPlan
 * CRUD already use (WaiversService.createWaiver's own comment: "same gate as
 * MembershipPlan/Class CRUD"), not the broader `assertStaffAtSchool` the
 * read-only Student roster uses — authoring a message to every Student (or a
 * whole Branch/Class) is a materially bigger-blast-radius action than reading
 * who's enrolled, so this follows the narrower, Owner-only precedent rather
 * than the broader Staff-read one.
 *
 * Lives in its own module (NotificationBroadcastModule), not inside
 * NotificationsModule itself — NotificationsModule is imported BY
 * TenantsModule already (RoleGrantsService.create()'s own invite email uses
 * NotificationDeliveryService), so importing TenantsModule back into
 * NotificationsModule for TenantAuthorizationService/SchoolsService would be
 * a genuine circular module dependency with no forwardRef precedent anywhere
 * in this codebase. A separate module that imports TenantsModule + QueueModule
 * and is imported by nothing avoids that entirely.
 *
 * Decision 363 — each broadcast is also written to NotificationBroadcast, the
 * School's sent-broadcast history (`findSentForSchool`). Written only after
 * the fanout jobs are queued, so the history lists only broadcasts that
 * actually went out: a failed enqueue leaves no row, so a retry is listed
 * once.
 */
/** The audience's names, copied onto the history row at send time. */
type AudienceLabel = Pick<
  Prisma.NotificationBroadcastUncheckedCreateInput,
  'branchId' | 'branchName' | 'classId' | 'classTitle' | 'classStartDate' | 'classAudience'
>;

@Injectable()
export class NotificationBroadcastService {
  private readonly logger = new Logger(NotificationBroadcastService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {}

  async broadcast(callerId: string, schoolId: string, dto: BroadcastNotificationDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes,
    // same guard every other School-Owner-gated write in this codebase
    // already applies (WaiversService.createWaiver/updateWaiver, etc).
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const { studentIds, label } = await this.resolveAudience(callerId, schoolId, dto);

    const broadcastId = randomUUID();
    if (studentIds.length > 0) {
      // Per-recipient job-dedup — the exact pattern
      // WaiverSignatureRequestsProcessor already established (one job per
      // distinct Student, jobId derived deterministically from this
      // broadcast's own id + the recipient, so a retried enqueue attempt
      // can't double-enqueue anyone already queued by an earlier attempt).
      // `addBulk` (not N sequential `.add()` calls) — same reasoning that
      // processor's own header comment gives: one pipelined Redis call
      // instead of N round-trips.
      await this.notificationFanoutQueue.addBulk(
        studentIds.map((studentId) => ({
          name: 'notify',
          data: {
            notificationId: `broadcast-${broadcastId}-${studentId}`,
            userId: studentId,
            title: dto.title,
            body: dto.body,
            type: 'SCHOOL_BROADCAST',
            schoolId,
            // A one-class broadcast opens that Class (Decision 355).
            ...(dto.audience === BroadcastAudienceDto.CLASS && dto.classId ? { targetType: 'CLASS' as const, targetId: dto.classId } : {}),
          } satisfies NotificationFanoutJobData,
          opts: {
            jobId: `broadcast-${broadcastId}-${studentId}`,
            attempts: 3,
            backoff: { type: 'exponential' as const, delay: 5000 },
            priority: BULK_NOTIFICATION_PRIORITY,
          },
        })),
      );
    }

    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const sender = await tx.user.findUniqueOrThrow({ where: { id: callerId }, select: { firstName: true, surname: true } });
      await tx.notificationBroadcast.create({
        data: {
          id: broadcastId,
          schoolId,
          sentById: callerId,
          sentByName: `${sender.firstName} ${sender.surname}`.trim(),
          title: dto.title,
          body: dto.body,
          audience: dto.audience,
          ...label,
          recipientCount: studentIds.length,
        },
      });
    });

    this.logger.log(`Broadcast ${broadcastId} (School ${schoolId}, audience ${dto.audience}) — fanned out to ${studentIds.length} Student(s).`);
    return { broadcastId, audience: dto.audience, recipientCount: studentIds.length };
  }

  /**
   * Resolves the audience to a distinct list of Student user ids, reusing
   * EXISTING roster queries rather than inventing a new one for each scope —
   * per the kickoff brief's own instruction.
   *
   * ALL: the exact query SchoolsService.findAllStudentsForSchool's ACTIVE
   * branch already uses (every active STUDENT RoleGrant at this School).
   *
   * BRANCH: Student enrollment itself has NO Branch dimension (RoleGrant
   * carries no branchId for a STUDENT grant — see
   * findAllStudentsForSchool's own header comment) — the only real,
   * confirmed Student-to-Branch link in this schema is `StudentHomeBranch`
   * (Decisions 139/148, grading's own "each student has one home branch"),
   * which SchoolsService.setStudentHomeBranch already writes. Intersected
   * with an active STUDENT RoleGrant at this School (a relation filter on
   * the SAME roleGrant query ALL uses above, not a second disjoint query) —
   * a StudentHomeBranch row can outlive the enrollment that created it (no
   * cascade on RoleGrant revocation), and a broadcast audience should never
   * include someone no longer actually enrolled.
   *
   * CLASS: the Class's own list, narrowed to the groups the Owner ticked
   * (`classAudience`, Decision 333) — booked (any Booking not cancelled),
   * waitlist (WAITING or NOTIFIED entries) and/or cancelled Bookings.
   * Booked only when nothing is ticked: before this, every Booking status
   * was sent to, so people who had cancelled still got it and the waitlist
   * never did.
   */
  private async resolveAudience(callerId: string, schoolId: string, dto: BroadcastNotificationDto): Promise<{ studentIds: string[]; label: AudienceLabel }> {
    if (dto.audience === BroadcastAudienceDto.ALL) {
      const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.roleGrant.findMany({
          where: { schoolId, role: 'STUDENT', revokedAt: null },
          distinct: ['userId'],
          select: { userId: true },
        }),
      );
      return { studentIds: grants.map((g) => g.userId), label: {} };
    }

    if (dto.audience === BroadcastAudienceDto.BRANCH) {
      if (!dto.branchId) {
        throw new BadRequestException('branchId is required when audience is BRANCH.');
      }
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
      // An archived Branch is gone from every picker (branchSelectOptions);
      // refused here too, the same way Staff role grants refuse one.
      const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.branch.findUnique({ where: { id: dto.branchId }, select: { name: true, archivedAt: true } }),
      );
      if (branch?.archivedAt) {
        throw new BadRequestException('This branch is archived. Pick a live branch, or send to all students.');
      }
      const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.roleGrant.findMany({
          where: {
            schoolId,
            role: 'STUDENT',
            revokedAt: null,
            user: { homeBranches: { some: { schoolId, branchId: dto.branchId } } },
          },
          distinct: ['userId'],
          select: { userId: true },
        }),
      );
      return { studentIds: grants.map((g) => g.userId), label: { branchId: dto.branchId, branchName: branch?.name ?? null } };
    }

    // CLASS
    if (!dto.classId) {
      throw new BadRequestException('classId is required when audience is CLASS.');
    }
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findUnique({ where: { id: dto.classId }, select: { id: true, schoolId: true, title: true, startDate: true, archivedAt: true } }),
    );
    if (!cls || cls.schoolId !== schoolId) {
      throw new NotFoundException('Class not found');
    }
    // An archived Class has been cancelled or taken off the schedule.
    if (cls.archivedAt) {
      throw new BadRequestException('This class is archived. Pick an upcoming class.');
    }
    const groups = new Set(dto.classAudience?.length ? dto.classAudience : [BroadcastClassAudienceDto.BOOKED]);
    const bookingStatuses: BookingStatus[] = [];
    if (groups.has(BroadcastClassAudienceDto.BOOKED)) bookingStatuses.push('UPCOMING', 'COMPLETED', 'NO_SHOW');
    if (groups.has(BroadcastClassAudienceDto.CANCELLED)) bookingStatuses.push('CANCELLED');
    const classId = cls.id;
    const { bookings, waitlist } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      bookings: bookingStatuses.length
        ? await tx.booking.findMany({ where: { classId, status: { in: bookingStatuses } }, distinct: ['studentId'], select: { studentId: true } })
        : [],
      waitlist: groups.has(BroadcastClassAudienceDto.WAITLIST)
        ? await tx.waitlistEntry.findMany({
            where: { classId, status: { in: ['WAITING', 'NOTIFIED'] } },
            distinct: ['studentId'],
            select: { studentId: true },
          })
        : [],
    }));
    return {
      studentIds: [...new Set([...bookings, ...waitlist].map((r) => r.studentId))],
      label: { classId, classTitle: cls.title, classStartDate: cls.startDate, classAudience: [...groups] },
    };
  }

  /**
   * Decision 363 — GET /schools/:schoolId/notifications/broadcasts: the
   * School's sent broadcasts, newest first, one page at a time. Same Owner
   * gate as sending one (RLS on NotificationBroadcast enforces it again).
   * Keyset-paginated on (createdAt, id) descending, the same shape as the
   * caller's own inbox (NotificationsService.findAllForCaller).
   */
  async findSentForSchool(callerId: string, schoolId: string, cursor?: string, limit?: number) {
    await this.schoolsService.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const take = resolveLimit(limit);
    let decoded: { sortValue: Date; id: string } | null = null;
    if (cursor) {
      try {
        decoded = decodeDescCursor(cursor);
      } catch {
        throw new BadRequestException('Invalid cursor.');
      }
      if (Number.isNaN(decoded.sortValue.getTime()) || typeof decoded.id !== 'string') {
        throw new BadRequestException('Invalid cursor.');
      }
    }
    const where: Prisma.NotificationBroadcastWhereInput = {
      schoolId,
      ...(decoded
        ? { OR: [{ createdAt: { lt: decoded.sortValue } }, { createdAt: decoded.sortValue, id: { lt: decoded.id } }] }
        : {}),
    };
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.notificationBroadcast.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1 }),
    );
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore ? encodeDescCursor(last.createdAt, last.id) : null };
  }
}
