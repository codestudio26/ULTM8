import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { cancelPlacesOfLeavingStudent } from '../bookings/leaving-student-cancellation';
import { eraseMemberFiles } from '../member-files/member-file-erasure';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { AccountDeletionService, hasOwnLogin } from '../account-deletion/account-deletion.service';
import { deletionFinalEmail, memberLeftNotice } from '../account-deletion/account-deletion-notices';
import { ACCOUNT_ERASURE_QUEUE, NOTIFICATION_FANOUT_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, after the other purge sweeps (tenant 3am). The 30 days are
 * day-granular, so once a day is enough. */
const CRON_DAILY_AT_4AM_UTC = '0 4 * * *';
const REPEATABLE_JOB_ID = 'account-erasure-sweep';
const PAGE = 100;

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see BookingNoShowProcessingScheduler). */
@Injectable()
export class AccountErasureScheduler implements OnModuleInit {
  private readonly logger = new Logger(AccountErasureScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(ACCOUNT_ERASURE_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...AccountErasureScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_4AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable account-erasure job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable account-erasure job after all retries — accounts past their 30 days will not be erased until this succeeds.');
  }
}

export interface AccountErasureResult {
  erased: string[];
  kept: string[];
  skipped: string[];
}

/**
 * "Delete my account" (Decision 427 item 5; the product owner's rules of
 * 6 Nov 2026), the final step: each account whose 30 days are over is
 * anonymised in place (Decision 245) by the narrow `erase_due_account`
 * database function (owned by ultm8_rls_helper; the jobs role may only call
 * it, and it refuses any account that isn't due). See that migration
 * (20270227100012_account_deletion) for exactly what is removed.
 *
 * Around it, this job:
 * - keeps a child whose parent asked, when the child has since got another
 *   active parent (rule 4, checked again now): only the asking parent's link
 *   ends, when that parent is erased; a KEPT line is logged;
 * - waits with a child until the parent who asked is erased;
 * - never erases the main owner of a School or Franchise that is still open
 *   (rule 5, checked again; it can't normally happen, the account is locked);
 * - deletes the files the Schools uploaded for them (stored copy, then row);
 * - gives up their upcoming bookings and waitlist places at each School, as
 *   when a School removes a member (no fee, no notice);
 * - deletes the profile photo, and the photo of each of their coach profiles
 *   (which the function clears and archives, Decision 445 item 1), from
 *   storage, sends the member the "your account
 *   has been deleted" email, and tells each School they were a member of
 *   (its owners, through the notification-fanout job, the same channel as
 *   other notices to owners) — rule 6.
 *
 * Every step is safe to repeat: a run that fails half way is finished by the
 * next one (the function only runs once per account; the notices and email
 * follow it).
 */
@Processor(ACCOUNT_ERASURE_QUEUE)
export class AccountErasureProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountErasureProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaApp: PrismaAppService,
    private readonly r2: R2ClientService,
    private readonly delivery: NotificationDeliveryService,
    private readonly accountDeletion: AccountDeletionService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const result = await this.sweep();
    this.logger.log(`account-erasure: erased ${result.erased.length}, kept ${result.kept.length}, waiting ${result.skipped.length}.`);
  }

  async sweep(now: Date = new Date()): Promise<AccountErasureResult> {
    const result: AccountErasureResult = { erased: [], kept: [], skipped: [] };
    let cursor: string | undefined;
    for (;;) {
      const due = await this.prismaJobs.user.findMany({
        where: { erasedAt: null, deletionRequestedAt: { not: null }, deletionDueAt: { lte: now }, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, deletionRequestedById: true },
        orderBy: { id: 'asc' },
        take: PAGE,
      });
      if (due.length === 0) break;
      cursor = due[due.length - 1].id;
      // The members who asked first, then the children their requests include.
      const ordered = [...due.filter((u) => !isChildOfRequest(u)), ...due.filter(isChildOfRequest)];
      for (const user of ordered) {
        try {
          const outcome = await this.handle(user, result);
          result[outcome].push(user.id);
        } catch (err) {
          result.skipped.push(user.id);
          this.logger.error(`account-erasure: ${user.id} not erased this run (retried tomorrow) — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (due.length < PAGE) break;
    }
    return result;
  }

  private async handle(user: { id: string; deletionRequestedById: string | null }, run: AccountErasureResult): Promise<keyof AccountErasureResult> {
    const requester = user.deletionRequestedById;
    if (requester && requester !== user.id) {
      // A child that came with a parent's request.
      if (await this.accountDeletion.hasOtherActiveParent(user.id, requester)) {
        await this.prismaJobs.user.updateMany({
          where: { id: user.id, erasedAt: null, deletionRequestedById: requester },
          data: { deletionRequestedAt: null, deletionDueAt: null, deletionRequestedById: null },
        });
        await this.prismaJobs.accountErasureLog.createMany({ data: [{ id: randomUUID(), userId: user.id, event: 'KEPT', requestedById: requester }] });
        return 'kept';
      }
      const parent = await this.prismaJobs.user.findUnique({ where: { id: requester }, select: { erasedAt: true } });
      if (!run.erased.includes(requester) && !parent?.erasedAt) return 'skipped';
    } else if ((await this.accountDeletion.mainOwnerBlocks(user.id)).length > 0) {
      this.logger.error(`account-erasure: ${user.id} is the main owner of an open School or Franchise — not erased.`);
      return 'skipped';
    }

    // Read before the details go: where to send the email, and which Schools
    // to tell (where they are a member now).
    const [person, memberships, files, coachProfiles] = await Promise.all([
      this.prismaJobs.user.findUnique({ where: { id: user.id }, select: { email: true } }),
      this.prismaJobs.roleGrant.findMany({
        where: { userId: user.id, role: 'STUDENT', revokedAt: null, schoolId: { not: null } },
        select: { schoolId: true },
        distinct: ['schoolId'],
      }),
      this.prismaJobs.memberFile.findMany({ where: { studentId: user.id }, select: { id: true } }),
      // Their coach profiles' photos (Decision 445 item 1): the function
      // clears the addresses, so they are read first and deleted after.
      this.prismaJobs.instructor.findMany({ where: { userId: user.id, photoUrl: { not: null } }, select: { photoUrl: true } }),
    ]);
    const passcodeHash = await bcrypt.hash(randomUUID(), 12);
    const rows = await this.prismaJobs.$queryRaw<Array<{ erased: boolean; old_photo_url: string | null }>>`
      SELECT * FROM "erase_due_account"(${user.id}, ${passcodeHash})`;
    if (!rows[0]?.erased) return 'skipped';

    const schoolIds = memberships.map((m) => m.schoolId!);
    const photos = new Set([rows[0].old_photo_url, ...coachProfiles.map((c) => c.photoUrl)].filter((u): u is string => !!u));
    for (const url of photos) await this.deletePhoto(user.id, url);
    // Files the Schools uploaded for them: the stored copy, then the row (the
    // function unlinked them; the daily offboarding sweep retries a failure).
    if (files.length > 0) await eraseMemberFiles(this.prismaJobs, this.r2, this.logger, { id: { in: files.map((f) => f.id) } });
    await this.giveUpPlaces(user.id, schoolIds);
    if (person && hasOwnLogin(person.email)) await this.sendFinalEmail(user.id, person.email);
    await this.tellSchools(user.id, schoolIds);
    return 'erased';
  }

  /**
   * Their upcoming bookings are cancelled and waitlist places removed at each
   * School, exactly as when a School removes a member (Decision 343,
   * cancelPlacesOfLeavingStudent): the credit rule of a staff cancel, no
   * late-cancellation fee, no money refunded, and no notice (that path sends
   * none). Run as the School's main owner, the context that may change those
   * rows; the cancellation is recorded as resolved by the member themselves.
   * Freed seats go to the waitlist afterwards. A School where it fails is
   * logged and left; the account itself is already erased.
   */
  private async giveUpPlaces(userId: string, schoolIds: string[]): Promise<void> {
    for (const schoolId of schoolIds) {
      try {
        const main = await this.prismaJobs.roleGrant.findFirst({
          where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
          orderBy: [{ isMainOwner: 'desc' }, { grantedAt: 'asc' }, { id: 'asc' }],
          select: { userId: true },
        });
        if (!main) continue;
        const { freedClassIds } = await this.prismaApp.withTenantContext(main.userId, (tx) =>
          cancelPlacesOfLeavingStudent(tx as Prisma.TransactionClient, schoolId, userId, userId, this.logger),
        );
        for (const classId of freedClassIds) {
          await this.waitlistCascadeQueue.add('seat-freed', { classId }).catch((err: unknown) => {
            this.logger.warn(`account-erasure: waitlist cascade for Class ${classId} not queued — ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      } catch (err) {
        this.logger.error(`account-erasure: ${userId}'s bookings at School ${schoolId} not cancelled — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async deletePhoto(userId: string, url: string | null): Promise<void> {
    if (!url || !this.r2.isConfigured()) return;
    try {
      await this.r2.deletePublicPhotoByUrl(url);
    } catch (err) {
      this.logger.warn(`account-erasure: ${userId}'s photo not deleted from storage — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sendFinalEmail(userId: string, email: string): Promise<void> {
    if (!this.delivery.isConfigured()) return;
    try {
      await this.delivery.sendEmail(email, deletionFinalEmail.subject, deletionFinalEmail.body);
    } catch (err) {
      this.logger.warn(`account-erasure: final email to ${userId} not sent — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Rule 6: each School's owners see that a member left. Unnamed: the
   * notice must not keep the details just removed. */
  private async tellSchools(userId: string, schoolIds: string[]): Promise<void> {
    if (schoolIds.length === 0) return;
    const owners = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId: { in: schoolIds }, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null, userId: { not: userId } },
      select: { userId: true, schoolId: true },
    });
    if (owners.length === 0) return;
    try {
      await this.fanoutQueue.addBulk(
        owners.map((o) => {
          const id = `account-erased-${userId}-${o.schoolId}-${o.userId}`;
          return {
            name: 'notify',
            data: { notificationId: id, userId: o.userId, title: memberLeftNotice.title, body: memberLeftNotice.body, type: 'MEMBER_LEFT', schoolId: o.schoolId! } satisfies NotificationFanoutJobData,
            opts: { jobId: id, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } },
          };
        }),
      );
    } catch (err) {
      this.logger.warn(`account-erasure: Schools not told about ${userId} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function isChildOfRequest(u: { id: string; deletionRequestedById: string | null }): boolean {
  return !!u.deletionRequestedById && u.deletionRequestedById !== u.id;
}
