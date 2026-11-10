import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../../tenants/tenant-authorization.service';
import { GuardiansService } from '../../guardians/guardians.service';
import { holdsPlace, placesTaken } from './plan-capacity';

/**
 * Decision 316 item 5, as answered by Decision 435 items 10-15: the waiting
 * list of a full plan.
 *
 * - A member joins when the plan is full (there is no line while there is
 *   room: they buy it); a parent can put their child on it (item 14), acting
 *   under the child's context as buying for them does. Joining twice gives the
 *   same place back.
 * - Leaving takes them off; a place held for them goes to the next person
 *   (plan-waitlist.processor.ts).
 * - The member (or parent) sees whether a plan is full, their place in line,
 *   and until when a place is held for them. The owner sees the whole line.
 */
@Injectable()
export class PlanWaitlistService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardians: GuardiansService,
  ) {}

  /** The member a request is for: the caller, or their child (item 14). */
  private async memberFor(callerId: string, studentId?: string): Promise<string> {
    if (!studentId || studentId === callerId) return callerId;
    await this.guardians.assertGuardianOfStudent(callerId, studentId, { purpose: 'pay' });
    return studentId;
  }

  /** A limited plan the member may join the line of: on sale and theirs to buy. */
  private async loadPlan(memberId: string, planId: string) {
    const plan = await this.prismaApp.withTenantContext(memberId, (tx) => tx.membershipPlan.findUnique({ where: { id: planId } }));
    if (!plan || plan.type === 'VISIT_PASS') throw new NotFoundException('MembershipPlan not found');
    const enrolled = await this.prismaApp.withTenantContext(memberId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: memberId, schoolId: plan.schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } }),
    );
    if (!enrolled) throw new ForbiddenException('Only a current Student of this School can join its waiting lists.');
    return plan;
  }

  async join(callerId: string, planId: string, studentId?: string) {
    const memberId = await this.memberFor(callerId, studentId);
    const plan = await this.loadPlan(memberId, planId);
    if (plan.archivedAt || !plan.visible) throw new BadRequestException('This plan is not on sale.');
    if (plan.memberLimit === null) {
      throw new BadRequestException({ code: 'PLAN_HAS_NO_LIMIT', message: "This plan has no member limit, so it has no waiting list. Buy it now." });
    }
    await this.tenantAuth.assertSchoolNotArchived(memberId, plan.schoolId);
    return this.prismaApp.withTenantContext(memberId, async (tx) => {
      // One join at a time per member and plan (a double tap).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan-waitlist:${memberId}:${planId}`}))`;
      const open = await tx.planWaitlistEntry.findFirst({ where: { membershipPlanId: planId, studentId: memberId, status: { in: ['WAITING', 'OFFERED'] } } });
      if (open) return this.view(tx, plan.id, open);
      if (await holdsPlace(tx, plan.id, memberId)) {
        throw new ConflictException({ code: 'ALREADY_A_MEMBER', message: 'You already have this plan.' });
      }
      if ((await placesTaken(tx, plan.id, memberId)) < plan.memberLimit!) {
        throw new ConflictException({ code: 'PLAN_HAS_ROOM', message: 'This plan has room now. Buy it instead.' });
      }
      const entry = await tx.planWaitlistEntry.create({
        data: { id: randomUUID(), schoolId: plan.schoolId, membershipPlanId: plan.id, studentId: memberId, joinedById: callerId },
      });
      return this.view(tx, plan.id, entry);
    });
  }

  async leave(callerId: string, planId: string, studentId?: string) {
    const memberId = await this.memberFor(callerId, studentId);
    const left = await this.prismaApp.withTenantContext(memberId, (tx) =>
      tx.planWaitlistEntry.updateMany({ where: { membershipPlanId: planId, studentId: memberId, status: { in: ['WAITING', 'OFFERED'] } }, data: { status: 'LEFT' } }),
    );
    return { left: left.count > 0 };
  }

  /** The School's limited plans, each with whether it is full for this member
   * and their place on its waiting list. */
  async availability(callerId: string, schoolId: string, studentId?: string) {
    const memberId = await this.memberFor(callerId, studentId);
    const result = await this.prismaApp.withTenantContext(memberId, async (tx) => {
      const enrolled = await tx.roleGrant.findFirst({ where: { userId: memberId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
      if (!enrolled) return null;
      const plans = await tx.membershipPlan.findMany({
        where: { schoolId, memberLimit: { not: null }, archivedAt: null, visible: true },
        select: { id: true, memberLimit: true },
        orderBy: { id: 'asc' },
      });
      const items: Array<{ planId: string; full: boolean; waitlist: Awaited<ReturnType<PlanWaitlistService['view']>> | null }> = [];
      for (const plan of plans) {
        const entry = await tx.planWaitlistEntry.findFirst({ where: { membershipPlanId: plan.id, studentId: memberId, status: { in: ['WAITING', 'OFFERED'] } } });
        const held = entry?.status === 'OFFERED' && entry.offerExpiresAt! > new Date();
        const full = !held && !(await holdsPlace(tx, plan.id, memberId)) && (await placesTaken(tx, plan.id, memberId)) >= plan.memberLimit!;
        items.push({ planId: plan.id, full, waitlist: entry ? await this.view(tx, plan.id, entry) : null });
      }
      return { items };
    });
    if (result) return result;
    // Decision 451 item 7 (S-2; Decision 449 item 6): the member isn't
    // enrolled here. Someone with no link to the School, or an unknown
    // School, gets 404 School not found as before; the School's own coach or
    // staff, a former member or a Guardian 403 NO_PERMISSION, paused staff
    // 403 ACCESS_PAUSED.
    return this.tenantAuth.refuseNoPermission(callerId, schoolId);
  }

  private async view(
    tx: { $queryRaw: (query: Prisma.Sql) => Promise<unknown> },
    planId: string,
    entry: { id: string; status: string; offerExpiresAt: Date | null; studentId: string },
  ) {
    const rows = (await tx.$queryRaw(Prisma.sql`SELECT "plan_waitlist_position"(${planId}, ${entry.studentId}) AS position`)) as Array<{ position: number | null }>;
    return { id: entry.id, status: entry.status, position: rows[0]?.position ?? null, offerExpiresAt: entry.offerExpiresAt };
  }

  /** The owner's view of a plan's line, first in line first. */
  async list(callerId: string, planId: string) {
    const plan = await this.prismaApp.withTenantContext(callerId, (tx) => tx.membershipPlan.findUnique({ where: { id: planId }, select: { id: true, schoolId: true, memberLimit: true } }));
    if (!plan) throw new NotFoundException('MembershipPlan not found');
    await this.tenantAuth.assertSchoolOwner(callerId, plan.schoolId);
    const entries = await this.prismaJobs.planWaitlistEntry.findMany({
      where: { membershipPlanId: planId, schoolId: plan.schoolId, status: { in: ['WAITING', 'OFFERED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { student: { select: { firstName: true, surname: true } } },
    });
    const taken = await placesTaken(this.prismaJobs, planId, null);
    return {
      memberLimit: plan.memberLimit,
      placesTaken: taken,
      items: entries.map((e) => ({
        id: e.id,
        studentId: e.studentId,
        firstName: e.student.firstName,
        surname: e.student.surname,
        status: e.status,
        joinedAt: e.createdAt,
        offerExpiresAt: e.offerExpiresAt,
      })),
    };
  }
}
