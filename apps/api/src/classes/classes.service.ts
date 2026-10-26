import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../jobs/queue.constants';
import { randomUUID } from 'crypto';
import { resolveClassStyles, styleIdsOf } from './class-styles';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { escapeLike } from '../common/search/name-search';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

const RETENTION_WINDOW_DAYS = 90;

@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly subscriptionGate: SubscriptionGateService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {}

  /**
   * School Owner/Manager only (Spec §8.2) — Class CRUD isn't among Instructor's
   * confirmed permissions (attendance scan, grading, booking override only — never
   * School settings), so it gets no write path here, same as Branch Staff.
   */
  async create(callerId: string, schoolId: string, dto: CreateClassDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    // Spec 55 §10.2's confirmed read-only degraded-portal state — "no new Classes"
    // is one of the three actions it explicitly names (Phase 54).
    await this.subscriptionGate.assertNotDegraded(callerId, schoolId);

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
    }
    if (dto.instructorId) {
      await this.tenantAuth.assertInstructorAssignable(callerId, dto.instructorId, schoolId, dto.branchId ?? null);
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.assertValidDateRange(startDate, endDate);

    const classId = randomUUID();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const { styles, activities } = await resolveClassStyles(tx, schoolId, dto.styles, dto.activities);
      return tx.class.create({
        data: {
          id: classId,
          schoolId,
          branchId: dto.branchId,
          instructorId: dto.instructorId,
          title: dto.title,
          activities,
          styles,
          bannerUrl: dto.bannerUrl,
          description: dto.description,
          startDate,
          endDate,
          capacity: dto.capacity,
          bookingEndAt: dto.bookingEndAt ? new Date(dto.bookingEndAt) : undefined,
          qrAttendanceEndAt: dto.qrAttendanceEndAt ? new Date(dto.qrAttendanceEndAt) : undefined,
          refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired ?? false,
          membershipInclusion: dto.membershipInclusion ?? false,
        },
      });
    });
  }

  /** Classes visible to the caller under one School — RLS restricts this to a School-
   * level grant (sees every Class, any Branch) or a Branch-scoped grant (their own
   * Branch's Classes plus School-wide ones — class_tenant_isolation, this phase's
   * migration).
   *
   * `activities`/`search` — additive, optional filters (School Portal's Classes page
   * Discipline filter + "Search classes" box, ClassesQueryDto). Both omitted behaves
   * exactly as before either filter existed. */
  /** Decision 226 — `includeArchived` (default false) excludes archived
   * Classes from the default view. */
  async findAllForSchool(
    callerId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
    activities?: string,
    search?: string,
    includeArchived?: boolean,
  ): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.class.findMany({
            ...args,
            where: {
              schoolId,
              ...(activities ? { activities: { has: activities } } : {}),
              // Decision 278 — `%`/`_` match themselves, not any text (escapeLike).
              ...(search ? { title: { contains: escapeLike(search), mode: 'insensitive' } } : {}),
              ...(includeArchived ? {} : { archivedAt: null }),
            },
          }),
        cursor,
        limit,
      ),
    );
  }

  async findOne(callerId: string, classId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findUnique({ where: { id: classId } }),
    );
    // RLS returns null (not another tenant's row) for a Class outside the caller's scope
    // — a genuine 404 and a cross-tenant-blocked read are indistinguishable at this layer
    // by design (ultm8-tenant-isolation §2).
    if (!found) {
      throw new NotFoundException('Class not found');
    }
    return found;
  }

  /** School Owner/Manager only — resolved via the Class's own schoolId, not a route param. */
  async update(callerId: string, classId: string, dto: UpdateClassDto) {
    const existing = await this.findOne(callerId, classId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    // Resolved "as of after this patch" values — string|null throughout, no
    // undefined round-trip needed since existing.branchId is already string|null.
    const nextBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId;
    const nextInstructorId = dto.instructorId !== undefined ? dto.instructorId : existing.instructorId;

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, existing.schoolId);
    }
    // Revalidated whenever the Class will still have an instructor after this patch —
    // not only when instructorId itself is part of the PATCH body. A branch-only PATCH
    // (instructorId omitted, so the existing one carries forward) can move the Class to
    // a Branch its existing instructor isn't authorized to teach at; without this, that
    // went unchecked (caught by /code-review's high-effort pass — see PR history).
    // Decision 311 (I5): only when the instructor or the branch actually
    // changes. A Class whose instructor has since left stays editable (to
    // reassign it, or fix its title) instead of failing on every save.
    if (nextInstructorId && nextInstructorId !== existing.instructorId) {
      await this.tenantAuth.assertInstructorAssignable(callerId, nextInstructorId, existing.schoolId, nextBranchId);
    } else if (nextInstructorId && nextBranchId !== existing.branchId) {
      await this.tenantAuth.assertValidInstructor(callerId, nextInstructorId, existing.schoolId, nextBranchId);
    }

    const nextStartDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const nextEndDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (dto.startDate || dto.endDate) {
      this.assertValidDateRange(nextStartDate, nextEndDate);
    }

    if ((dto as { styles?: unknown }).styles === null) {
      throw new BadRequestException('styles cannot be null; omit it to leave the styles unchanged.');
    }

    let seatsToOffer = 0;
    const updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Capacity can't drop below the seats already taken (product owner, 26 Oct
      // 2026; the stress test cut a class of 8 bookings to 3 unchallenged). The row
      // lock is the same one booking takes, so no booking slips in meanwhile.
      if (dto.capacity !== undefined && dto.capacity !== null) {
        await tx.$queryRaw`SELECT id FROM "Class" WHERE id = ${classId} FOR UPDATE`;
        const [bookings, guests] = await Promise.all([
          tx.booking.count({ where: { classId, status: 'UPCOMING' } }),
          tx.bookingAttendee.count({ where: { booking: { classId, status: 'UPCOMING' } } }),
        ]);
        const taken = bookings + guests;
        if (dto.capacity < taken) {
          throw new ConflictException({
            code: 'CAPACITY_BELOW_BOOKED',
            message: `${taken} ${taken === 1 ? 'student is' : 'students are'} booked. Cancel some bookings first, or set the capacity to ${taken} or more.`,
          });
        }
        // Seats a raise frees go to the waitlist first: with Students queued,
        // nobody can book them directly (waitlist first), so offer them now.
        const [waiting, notified] = await Promise.all([
          tx.waitlistEntry.count({ where: { classId, status: 'WAITING' } }),
          tx.waitlistEntry.count({ where: { classId, status: 'NOTIFIED' } }),
        ]);
        seatsToOffer = Math.max(0, Math.min(waiting, dto.capacity - taken - notified));
      }
      // Styles are replaced when sent and kept when omitted (Decision 170).
      const resolved = dto.styles !== undefined ? await resolveClassStyles(tx, existing.schoolId, dto.styles, dto.activities, styleIdsOf(existing.styles)) : null;
      return tx.class.update({
        where: { id: classId },
        data: {
          branchId: dto.branchId,
          instructorId: dto.instructorId,
          title: dto.title,
          activities: resolved ? resolved.activities : dto.activities,
          styles: resolved ? resolved.styles : undefined,
          bannerUrl: dto.bannerUrl,
          description: dto.description,
          startDate: dto.startDate ? nextStartDate : undefined,
          endDate: dto.endDate ? nextEndDate : undefined,
          capacity: dto.capacity,
          bookingEndAt: dto.bookingEndAt ? new Date(dto.bookingEndAt) : undefined,
          qrAttendanceEndAt: dto.qrAttendanceEndAt ? new Date(dto.qrAttendanceEndAt) : undefined,
          refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired,
          membershipInclusion: dto.membershipInclusion,
        },
      });
    });
    for (let i = 0; i < seatsToOffer; i++) {
      try {
        await this.waitlistCascadeQueue.add('seat-freed', { classId });
      } catch (err) {
        this.logger.warn(`Failed to enqueue waitlist-cascade-processing after raising Class ${classId}'s capacity: ${err}`);
      }
    }
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Decision 226 — entity-level tenant offboarding. Same shape/reasoning as
  // BranchesService's own identical archive()/unarchive() pair — see that
  // method's own header comment for the full account (TOCTOU-safe
  // conditional updateMany, idempotent, School-Owner-gated).
  // ---------------------------------------------------------------------------

  /** Active dependents that block archiving a Class — the task's own starting
   * hint, verified against the real schema: Booking.classId is `ON DELETE
   * RESTRICT` (not Cascade/SetNull), so ANY Booking ever made against this
   * Class — even a long-Completed/Cancelled one — will independently block
   * the eventual hard-purge regardless of this check; this check is the
   * narrower, "don't even let it archive" guard for the two LIVE cases that
   * actually matter to a caller archiving today: an UPCOMING Booking, or an
   * active (Waiting/Notified) WaitlistEntry — archiving a Class students are
   * actively booked/queued into would strand them. */
  private async assertNoActiveDependents(callerId: string, classId: string): Promise<void> {
    const [upcomingBookings, activeWaitlist] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.booking.count({ where: { classId, status: 'UPCOMING' } }),
        tx.waitlistEntry.count({ where: { classId, status: { in: ['WAITING', 'NOTIFIED'] } } }),
      ]),
    );
    const reasons: string[] = [];
    if (upcomingBookings > 0) reasons.push(`${upcomingBookings} upcoming booking${upcomingBookings === 1 ? '' : 's'}`);
    if (activeWaitlist > 0) reasons.push(`${activeWaitlist} student${activeWaitlist === 1 ? '' : 's'} on its waitlist`);
    if (reasons.length > 0) {
      throw new ConflictException(`This Class can't be archived while it still has ${reasons.join(' and ')}.`);
    }
  }

  async archive(callerId: string, classId: string) {
    const existing = await this.findOne(callerId, classId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return existing;
    }
    await this.assertNoActiveDependents(callerId, classId);

    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.updateMany({ where: { id: classId, archivedAt: null }, data: { archivedAt: now, purgeAt } }),
    );
    return this.findOne(callerId, classId);
  }

  async unarchive(callerId: string, classId: string) {
    const existing = await this.findOne(callerId, classId);
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (!existing.archivedAt) {
      return existing;
    }
    if (existing.purgedAt) {
      throw new ConflictException('This Class has already been purged and cannot be unarchived.');
    }
    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.updateMany({
        where: { id: classId, archivedAt: { not: null }, purgedAt: null },
        data: { archivedAt: null, purgeAt: null },
      }),
    );
    if (count === 0) {
      const current = await this.findOne(callerId, classId);
      if (current.purgedAt) {
        throw new ConflictException('This Class has already been purged and cannot be unarchived.');
      }
      return current;
    }
    return this.findOne(callerId, classId);
  }

  // branchId/instructorId validation moved to TenantAuthorizationService in Phase 5 —
  // TimetableSlotsService needs the identical two checks, and copying them a third
  // time (after role-grants.service.ts's own original) was explicitly the wrong move
  // per Phase 4's code review. See TenantAuthorizationService.assertBranchBelongsToSchool
  // / assertValidInstructor.

  private assertValidDateRange(startDate: Date, endDate: Date) {
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }
  }
}
