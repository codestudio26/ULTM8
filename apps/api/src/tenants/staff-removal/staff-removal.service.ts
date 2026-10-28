import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { RoleGrantsService } from '../role-grants/role-grants.service';
import { CancellationService } from '../../bookings/cancellation.service';
import { RemoveFromSchoolDto } from '../role-grants/dto/staff-list.dto';

/** What the person teaches at this School: upcoming Classes (not ended,
 * cancelled or archived) and active weekly slots (ON, not archived). The same
 * test "Hand over classes" and Decision 331 use, less Classes already
 * cancelled: nobody teaches those, so there is nothing to choose for them. */
function teachingWhere(schoolId: string, userId: string, now: Date) {
  return {
    classes: { schoolId, instructorId: userId, endDate: { gte: now }, archivedAt: null, cancelledAt: null } satisfies Prisma.ClassWhereInput,
    slots: { schoolId, instructorId: userId, status: 'ON', archivedAt: null } satisfies Prisma.TimetableSlotWhereInput,
  };
}

/**
 * "Remove from School" (Decision 361), with the product owner's 28 Oct 2026
 * answer for a coach who still teaches: the removal always goes ahead, and in
 * the same step the owner says what happens to their upcoming Classes and
 * weekly slots:
 *  - REASSIGN: both go to another coach at this School, checked branch by
 *    branch the way "Hand over classes" checks them (assertInstructorAssignable);
 *  - NONE: both run with no instructor until the owner picks one;
 *  - CANCEL: each Class is cancelled exactly as the School cancels a class
 *    (CancellationService.cancelClass: students told, credit or refund per the
 *    School's settings). Slots get no instructor, as with NONE: no rule says
 *    a coach leaving ends a weekly slot.
 * Without a choice, someone who teaches is refused (409 STAFF_STILL_TEACHING)
 * so the portal can ask; someone who teaches nothing is removed as before.
 *
 * Moving or clearing happens in the same transaction as the role removal.
 * Cancelling runs after it, one Class at a time, each in its own transactions;
 * if that stops part-way, sending the same request again (with CANCEL) finishes
 * it even though the roles are already gone.
 *
 * Its own module because cancelling needs BookingsModule, which imports
 * TenantsModule.
 */
@Injectable()
export class StaffRemovalService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly roleGrants: RoleGrantsService,
    private readonly cancellation: CancellationService,
  ) {}

  /** GET /schools/{schoolId}/staff/{userId}/teaching (owner only). */
  async teaching(callerId: string, schoolId: string, userId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const where = teachingWhere(schoolId, userId, new Date());
    const [upcomingClasses, activeSlots] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([tx.class.count({ where: where.classes }), tx.timetableSlot.count({ where: where.slots })]),
    );
    return { upcomingClasses, activeSlots };
  }

  /** POST /schools/{schoolId}/staff/{userId}/remove (owner only). */
  async remove(callerId: string, schoolId: string, userId: string, dto: RemoveFromSchoolDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const choice = dto.classes;
    if (choice === 'REASSIGN' && !dto.toUserId) {
      throw new BadRequestException('Choose the coach who takes over their classes.');
    }
    if (choice !== 'REASSIGN' && dto.toUserId) {
      throw new BadRequestException('Pick a coach only when giving their classes to another coach.');
    }
    if (dto.toUserId === userId) {
      throw new BadRequestException('Choose a different coach to take over.');
    }

    const where = teachingWhere(schoolId, userId, new Date());
    const [classes, slots, activeRoles] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.class.findMany({ where: where.classes, select: { id: true, branchId: true } }),
        tx.timetableSlot.findMany({ where: where.slots, select: { id: true, branchId: true } }),
        tx.roleGrant.count({ where: { userId, schoolId, revokedAt: null, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] } } }),
      ]),
    );
    const done = { classesReassigned: 0, classesCleared: 0, classesCancelled: 0, slotsReassigned: 0, slotsCleared: 0 };

    // A retry after the roles were removed but some cancellations didn't run:
    // finish them. Already-cancelled Classes are included so one left half done
    // is resumed (cancelClass skips one with nothing left to do).
    if (activeRoles === 0 && choice === 'CANCEL') {
      const leftover = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.class.findMany({ where: { ...where.classes, cancelledAt: undefined }, select: { id: true } }),
      );
      const cancelled = await this.cancelEach(callerId, leftover.map((c) => c.id));
      if (cancelled > 0) return { removedRoles: 0, ...done, classesCancelled: cancelled };
    }

    if (classes.length + slots.length > 0 && activeRoles > 0 && !choice) {
      const parts = [
        classes.length > 0 ? `${classes.length} upcoming class${classes.length === 1 ? '' : 'es'}` : null,
        slots.length > 0 ? `${slots.length} weekly timetable slot${slots.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      throw new ConflictException({
        code: 'STAFF_STILL_TEACHING',
        message: `They still teach ${parts.join(' and ')} here. Choose what happens to them: give them to another coach, keep them with no coach for now, or cancel the classes.`,
      });
    }

    if (choice === 'REASSIGN') {
      // The same check "Hand over classes" and a Class/slot edit make: an
      // active, unarchived coach whose role covers each row's branch. Checked
      // once for the School even with nothing to move, so a wrong pick is
      // always refused.
      const branchIds = new Set<string | null>([null, ...[...classes, ...slots].map((r) => r.branchId)]);
      for (const branchId of branchIds) {
        await this.tenantAuth.assertInstructorAssignable(callerId, dto.toUserId!, schoolId, branchId);
      }
    }

    const { removedRoles, also } = await this.roleGrants.removeFromSchool(callerId, schoolId, userId, async (tx) => {
      const classIds = { id: { in: classes.map((c) => c.id) }, instructorId: userId };
      const slotIds = { id: { in: slots.map((t) => t.id) }, instructorId: userId };
      if (choice === 'REASSIGN') {
        const movedClasses = await tx.class.updateMany({ where: classIds, data: { instructorId: dto.toUserId } });
        const movedSlots = await tx.timetableSlot.updateMany({ where: slotIds, data: { instructorId: dto.toUserId } });
        return { classesReassigned: movedClasses.count, slotsReassigned: movedSlots.count };
      }
      if (choice === 'NONE' || choice === 'CANCEL') {
        // CANCEL's Classes keep their coach until they are cancelled below,
        // as any cancelled class does.
        const cleared = choice === 'NONE' ? await tx.class.updateMany({ where: classIds, data: { instructorId: null } }) : { count: 0 };
        const clearedSlots = await tx.timetableSlot.updateMany({ where: slotIds, data: { instructorId: null } });
        return { classesCleared: cleared.count, slotsCleared: clearedSlots.count };
      }
      return {};
    });

    const classesCancelled = choice === 'CANCEL' ? await this.cancelEach(callerId, classes.map((c) => c.id)) : 0;
    return { removedRoles, ...done, ...also, classesCancelled };
  }

  /** Cancels each Class as the School would. One cancelled meanwhile by
   * someone else (409) or already finished (400) is skipped; anything else
   * stops here, and the same request can be sent again to finish. */
  private async cancelEach(callerId: string, classIds: string[]): Promise<number> {
    let cancelled = 0;
    for (const id of classIds) {
      try {
        await this.cancellation.cancelClass(callerId, id, undefined);
        cancelled += 1;
      } catch (err) {
        if (err instanceof ConflictException || err instanceof BadRequestException) continue;
        throw err;
      }
    }
    return cancelled;
  }
}
