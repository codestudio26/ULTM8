import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';

/**
 * v1.2 backend backlog's "Compose/broadcast a message to Students" gap
 * (Decision 230) — the first place in this codebase a School Owner directly
 * authors a Notification, rather than one being written only by the
 * internal `notification-fanout` job in response to a system event (a
 * Waiver assigned, a payment dispute, a chargeback-pattern restriction).
 *
 * Deliberately a separate module from NotificationsModule, not a new method
 * on NotificationsService: NotificationsModule is already imported BY
 * TenantsModule (for CoachInvitesService's own invite email), so importing
 * TenantsModule back into NotificationsModule for TenantAuthorizationService/
 * SchoolsService would be circular. This module follows WaiversModule's own
 * precedent instead — a sibling module that imports both TenantsModule and
 * QueueModule directly, never imported by TenantsModule itself.
 *
 * Enumerates RoleGrant and bulk-enqueues directly onto `notification-fanout`
 * itself, reusing WaiverSignatureRequestsProcessor's own per-recipient
 * job-dedup pattern (deterministic jobId per (broadcast, Student), `addBulk`
 * over N sequential `.add()` calls) — but without WaiverSignatureRequestsProcessor's
 * own intermediate queue hop, since there's no async lookup needed first here
 * (title/body come straight from the caller's own request, not a DB row
 * fetched by a separate job).
 */
@Injectable()
export class NotificationBroadcastService {
  private readonly logger = new Logger(NotificationBroadcastService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {}

  /** School Owner/Manager only — same gate as Waiver/MembershipPlan CRUD. */
  async broadcastToSchool(callerId: string, schoolId: string, dto: BroadcastNotificationDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const studentGrants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: { schoolId, role: 'STUDENT', revokedAt: null },
        select: { userId: true },
        distinct: ['userId'],
      }),
    );

    const broadcastId = randomUUID();

    // Unlike WaiversService.createWaiver's own "log and still return 201" choice —
    // there the Waiver row was already durably created, so a fanout-enqueue
    // failure is a lost notification but not a lost Waiver. Here the broadcast
    // itself has no other durable effect: if the enqueue fails, nothing
    // happened at all, so the caller needs to know it failed rather than get a
    // false-positive success.
    if (studentGrants.length > 0) {
      try {
        await this.notificationFanoutQueue.addBulk(
          studentGrants.map((grant) => ({
            name: 'notify',
            data: {
              notificationId: `broadcast-${broadcastId}-${grant.userId}`,
              userId: grant.userId,
              title: dto.title,
              body: dto.body,
              type: 'SCHOOL_BROADCAST',
            } satisfies NotificationFanoutJobData,
            opts: {
              jobId: `broadcast-${broadcastId}-${grant.userId}`,
              attempts: 3,
              backoff: { type: 'exponential' as const, delay: 5000 },
            },
          })),
        );
      } catch (err) {
        this.logger.error(
          `Broadcast ${broadcastId} (School ${schoolId}) could not be enqueued to notification-fanout.`,
          err instanceof Error ? err.stack : String(err),
        );
        throw new ServiceUnavailableException('Could not send the broadcast — please try again.');
      }
    }

    return { recipientCount: studentGrants.length };
  }
}
