import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { RolesChangedService } from '../common/prisma/roles-changed.service';
import { StepUpService } from '../auth/step-up.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { cancelSubscriptionAtPeriodEnd } from '../memberships/cancel-subscription';
import { endBalanceBilling } from '../charges/membership-series';
import { GUARDIAN_MANAGED_EMAIL_DOMAIN } from '../guardians/guardians.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { deletionRequestedNotice } from './account-deletion-notices';

/** Rule 2: signing in again within this many days cancels the deletion. */
export const DELETION_GRACE_DAYS = 30;

export type KeptReason = 'OTHER_PARENT' | 'OWN_LOGIN';

export interface ChildOutcome {
  studentId: string;
  firstName: string;
  surname: string;
}

export interface MainOwnerBlock {
  kind: 'SCHOOL' | 'FRANCHISE';
  id: string;
  name: string;
}

export interface DeletionState {
  pending: boolean;
  requestedAt: Date | null;
  dueAt: Date | null;
  graceDays: number;
  blockedBy: MainOwnerBlock[];
  childrenDeleted: ChildOutcome[];
  childrenKept: Array<ChildOutcome & { reason: KeptReason }>;
}

/** Sent with a code, so the app shows its own (translated) wording and the
 * names from the preview. */
const MAIN_OWNER_MUST_HAND_OVER = {
  code: 'MAIN_OWNER_MUST_HAND_OVER',
  message:
    "You're the main owner of a School or Franchise. Hand it to another owner (ULTM8 support can do this) or close it before you delete your account.",
};

const SUBSCRIPTION_NOT_STOPPED = {
  code: 'SUBSCRIPTION_NOT_STOPPED',
  message: "We couldn't stop a recurring payment just now, so your account hasn't been deleted. Please try again in a moment.",
};

/**
 * "Delete my account" (Decision 427 item 5; the product owner's six rules of
 * 6 Nov 2026), the request side. Decision 245's anonymise-in-place design:
 * nothing is deleted here — the account (and each child that goes with it) is
 * marked and locked; the account-erasure job anonymises it once the 30 days
 * are over (AccountErasureProcessor), and signing in again before then cancels
 * it (AuthService.login → cancelOnSignIn).
 *
 * - Rule 5: the main owner of a School or Franchise that is still open can't
 *   ask (MAIN_OWNER_MUST_HAND_OVER).
 * - Rule 4: each linked child with another active parent, or with a login of
 *   their own, stays (only this parent's link ends, at the end); a child with
 *   no other active parent and no login of their own is deleted with them.
 * - Rule 3: every running Subscription of theirs (and of those children) is
 *   cancelled at Stripe now (at the end of the paid period, as when a member
 *   leaves a School, Decision 343), and every recurring charge a School set up
 *   for them stops; unpaid charges stay on the School's books.
 * - Rule 2: the account is locked at once: every refresh token is revoked and
 *   the roles stamp moves, so every access token is refused on its next use
 *   (JwtStrategy, Decision 361), and bookings, check-ins and purchases made
 *   for them are refused (assertAccountNotClosing).
 * - Rule 6: the member is told (in-app notice, push and email through the
 *   notification-fanout job) and a REQUESTED line goes in AccountErasureLog.
 *
 * Step-up re-authentication (Decision 236) is required: deleting an account is
 * the most consequential thing a member can do.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly stepUp: StepUpService,
    private readonly stripeClient: StripeClientService,
    private readonly rolesChanged: RolesChangedService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {}

  /** GET /users/me/deletion: what deleting the account would do (or, once
   * asked, when it becomes final). */
  async preview(callerId: string): Promise<DeletionState> {
    const user = await this.loadSelf(callerId);
    const [blockedBy, children] = await Promise.all([this.mainOwnerBlocks(callerId), this.classifyChildren(callerId)]);
    return {
      pending: !!user.deletionRequestedAt,
      requestedAt: user.deletionRequestedAt,
      dueAt: user.deletionDueAt,
      graceDays: DELETION_GRACE_DAYS,
      blockedBy,
      childrenDeleted: user.deletionRequestedAt ? await this.childrenMarkedBy(callerId) : children.deleted,
      childrenKept: children.kept,
    };
  }

  /** POST /users/me/deletion. Asking again while it is pending changes nothing. */
  async request(callerId: string, stepUpToken: string | undefined): Promise<DeletionState> {
    this.stepUp.assertVerified(callerId, stepUpToken);
    const user = await this.loadSelf(callerId);
    if (user.deletionRequestedAt) return this.preview(callerId);

    if ((await this.mainOwnerBlocks(callerId)).length > 0) {
      throw new ConflictException(MAIN_OWNER_MUST_HAND_OVER);
    }
    const { deleted } = await this.classifyChildren(callerId);
    const people = [callerId, ...deleted.map((c) => c.studentId)];

    // Rule 3, first: if Stripe refuses, nothing is locked and they can try
    // again; a retry finds the Subscriptions already cancelled and moves on.
    for (const personId of people) await this.stopSubscriptions(personId, callerId);
    // A School's own recurring charges for them stop too, as they do when a
    // member leaves (the charge-recurring job's STUDENT_LEFT stop), so no new
    // debt builds up while the deletion waits. Debts already owed stay.
    await this.prismaJobs.recurringCharge.updateMany({
      where: { studentId: { in: people }, stoppedAt: null },
      data: { stoppedAt: new Date(), stoppedReason: 'STUDENT_LEFT', stoppedById: null },
    });

    const now = new Date();
    const dueAt = new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const marked = await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      const done: string[] = [];
      // Each row written as its own person (the self policy), the same way a
      // parent's child is created (GuardiansService.createMinor), after the
      // link was checked above.
      for (const personId of people) {
        await setContext(personId);
        const { count } = await tx.user.updateMany({
          where: { id: personId, deletionRequestedAt: null, erasedAt: null },
          data: { deletionRequestedAt: now, deletionDueAt: dueAt, deletionRequestedById: callerId, rolesChangedAt: now },
        });
        if (count > 0) done.push(personId);
      }
      return done;
    });
    if (!marked.includes(callerId)) return this.preview(callerId); // a second click won the race

    await this.prismaAuth.refreshToken.updateMany({ where: { userId: { in: marked }, revokedAt: null }, data: { revokedAt: now } });
    for (const personId of marked) this.rolesChanged.forget(personId);
    await this.prismaJobs.accountErasureLog.createMany({
      data: marked.map((userId) => ({ id: randomUUID(), userId, event: 'REQUESTED' as const, requestedById: callerId, at: now })),
    });

    const childNames = deleted.filter((c) => marked.includes(c.studentId)).map((c) => `${c.firstName} ${c.surname}`.trim());
    const notice = deletionRequestedNotice(dueAt, childNames);
    const id = `account-deletion-requested-${callerId}-${now.getTime()}`;
    try {
      await this.fanoutQueue.add(
        'notify',
        { notificationId: id, userId: callerId, title: notice.title, body: notice.body, type: 'ACCOUNT_DELETION' } satisfies NotificationFanoutJobData,
        { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      // The request stands; only the confirmation is missing.
      this.logger.warn(`Account deletion ${callerId}: confirmation not queued — ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.preview(callerId);
  }

  private async loadSelf(callerId: string) {
    const user = await this.prismaAuth.user.findUnique({
      where: { id: callerId },
      select: { deletionRequestedAt: true, deletionDueAt: true, erasedAt: true },
    });
    if (!user || user.erasedAt) throw new NotFoundException('User not found');
    return user;
  }

  /** Rule 5: the Schools and Franchises, still open, whose main owner this is. */
  async mainOwnerBlocks(userId: string): Promise<MainOwnerBlock[]> {
    const grants = await this.prismaJobs.roleGrant.findMany({
      where: { userId, revokedAt: null, role: { in: ['SCHOOL_OWNER_MANAGER', 'FRANCHISE_OWNER'] } },
      select: { role: true, schoolId: true, franchiseId: true },
    });
    const blocks: MainOwnerBlock[] = [];
    for (const g of grants) {
      if (g.role === 'SCHOOL_OWNER_MANAGER' && g.schoolId) {
        if ((await this.mainOwnerOf({ schoolId: g.schoolId, role: g.role })) !== userId) continue;
        const school = await this.prismaJobs.school.findUnique({ where: { id: g.schoolId }, select: { id: true, name: true, archivedAt: true } });
        if (school && !school.archivedAt && !blocks.some((b) => b.id === school.id)) blocks.push({ kind: 'SCHOOL', id: school.id, name: school.name });
      } else if (g.role === 'FRANCHISE_OWNER' && g.franchiseId && !g.schoolId) {
        if ((await this.mainOwnerOf({ franchiseId: g.franchiseId, schoolId: null, role: g.role })) !== userId) continue;
        const franchise = await this.prismaJobs.franchise.findUnique({ where: { id: g.franchiseId }, select: { id: true, name: true, archivedAt: true } });
        if (franchise && !franchise.archivedAt && !blocks.some((b) => b.id === franchise.id)) blocks.push({ kind: 'FRANCHISE', id: franchise.id, name: franchise.name });
      }
    }
    return blocks;
  }

  /** The main owner: the flagged grant, else the earliest (mainOwnerGrant). */
  private async mainOwnerOf(scope: { schoolId?: string | null; franchiseId?: string; role: 'SCHOOL_OWNER_MANAGER' | 'FRANCHISE_OWNER' }): Promise<string | null> {
    const main = await this.prismaJobs.roleGrant.findFirst({
      where: { ...scope, revokedAt: null },
      orderBy: [{ isMainOwner: 'desc' }, { grantedAt: 'asc' }, { id: 'asc' }],
      select: { userId: true },
    });
    return main?.userId ?? null;
  }

  /** Rule 4, for each child actively linked to this parent. A child already
   * being deleted (with another parent's request) is neither. */
  async classifyChildren(guardianId: string): Promise<{ deleted: ChildOutcome[]; kept: Array<ChildOutcome & { reason: KeptReason }> }> {
    const links = await this.prismaJobs.guardianLink.findMany({ where: { guardianId, revokedAt: null }, select: { studentId: true } });
    const deleted: ChildOutcome[] = [];
    const kept: Array<ChildOutcome & { reason: KeptReason }> = [];
    for (const { studentId } of links) {
      const child = await this.prismaAuth.user.findUnique({
        where: { id: studentId },
        select: { id: true, email: true, firstName: true, surname: true, erasedAt: true, deletionRequestedAt: true, deletionRequestedById: true },
      });
      if (!child || child.erasedAt) continue;
      if (child.deletionRequestedAt && child.deletionRequestedById !== guardianId) continue;
      const outcome = { studentId: child.id, firstName: child.firstName, surname: child.surname };
      if (await this.hasOtherActiveParent(studentId, guardianId)) kept.push({ ...outcome, reason: 'OTHER_PARENT' });
      else if (hasOwnLogin(child.email)) kept.push({ ...outcome, reason: 'OWN_LOGIN' });
      else deleted.push(outcome);
    }
    return { deleted, kept };
  }

  /** Another parent linked to the child whose own account isn't being deleted. */
  async hasOtherActiveParent(studentId: string, guardianId: string): Promise<boolean> {
    const others = await this.prismaJobs.guardianLink.findMany({
      where: { studentId, revokedAt: null, guardianId: { not: guardianId } },
      select: { guardianId: true },
    });
    if (others.length === 0) return false;
    const active = await this.prismaAuth.user.count({
      where: { id: { in: others.map((o) => o.guardianId) }, deletionRequestedAt: null, erasedAt: null },
    });
    return active > 0;
  }

  private async childrenMarkedBy(guardianId: string): Promise<ChildOutcome[]> {
    return this.prismaAuth.user.findMany({
      where: { deletionRequestedById: guardianId, id: { not: guardianId }, erasedAt: null, deletionRequestedAt: { not: null } },
      select: { id: true, firstName: true, surname: true },
      orderBy: { firstName: 'asc' },
    }).then((rows) => rows.map((r) => ({ studentId: r.id, firstName: r.firstName, surname: r.surname })));
  }

  /** Rule 3: every running Subscription of this person, at every School,
   * cancelled at Stripe at the end of its paid period (the same call a member
   * leaving a School gets, RoleGrantsService). Read and written as the person. */
  private async stopSubscriptions(personId: string, callerId: string): Promise<void> {
    const now = new Date();
    const subscriptions = await this.prismaApp.withTenantContext(personId, (tx) =>
      tx.membership.findMany({
        where: {
          studentId: personId,
          status: 'ACTIVE',
          cancelAt: null,
          AND: [
            // Decision 441 item 1: a monthly plan billed to the balance (a
            // School that takes no cards) ends at its next billing day too.
            { OR: [{ stripeSubscriptionId: { not: null } }, { billedToBalance: true }] },
            { OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
          ],
        },
        select: { id: true, schoolId: true, status: true, stripeSubscriptionId: true, cancelAt: true, billedToBalance: true },
      }),
    );
    for (const membership of subscriptions) {
      try {
        const cancelled = await this.prismaApp.withTenantContext(personId, (tx) => cancelSubscriptionAtPeriodEnd(this.stripeClient, tx, membership, callerId));
        // Decision 446 item 3: a monthly plan billed to the balance: its series ends with it.
        if (cancelled.billedToBalance && cancelled.cancelAt) await endBalanceBilling(this.prismaJobs, cancelled.id, cancelled.cancelAt, this.logger);
      } catch (err) {
        // Nothing here can cancel it (e.g. the School's Stripe account is
        // gone): the School deals with it in Stripe; it mustn't block deleting.
        if (err instanceof BadRequestException) {
          this.logger.warn(`Account deletion ${callerId}: Subscription Membership ${membership.id} not cancelled — ${err.message}`);
          continue;
        }
        this.logger.warn(`Account deletion ${callerId}: Stripe refused to cancel Membership ${membership.id} — ${err instanceof Error ? err.message : String(err)}`);
        throw new ServiceUnavailableException(SUBSCRIPTION_NOT_STOPPED);
      }
    }
  }
}

/** A child made by a parent in the app has a placeholder email nobody can sign
 * in with (GuardiansService.createMinor); anyone else has a login of their own. */
export function hasOwnLogin(email: string): boolean {
  return !email.toLowerCase().endsWith(`@${GUARDIAN_MANAGED_EMAIL_DOMAIN}`);
}
