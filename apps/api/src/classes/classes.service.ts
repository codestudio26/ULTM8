import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../jobs/queue.constants';
import { randomUUID } from 'crypto';
import { resolveClassStyles, styleIdsOf } from './class-styles';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { cursorPaginate, CursorPage, decodeDescCursor, encodeDescCursor, resolveLimit } from '../common/pagination/cursor-paginate';
import { applyCapacityChange, offerSeatsToWaitlist } from './class-seats';
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
    this.assertValidCutoffs(startDate, endDate, {
      bookingEndAt: dto.bookingEndAt ? new Date(dto.bookingEndAt) : null,
      qrAttendanceEndAt: dto.qrAttendanceEndAt ? new Date(dto.qrAttendanceEndAt) : null,
      refundFeeDate: dto.refundFeeDate ? new Date(dto.refundFeeDate) : null,
    });

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
    filter: {
      disciplineId?: string;
      startsFrom?: string;
      startsTo?: string;
      when?: 'upcoming' | 'past' | 'all';
      instructorId?: string;
    } = {},
  ): Promise<CursorPage<{ id: string }>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const where: Prisma.ClassWhereInput = {
      schoolId,
      ...(activities ? { activities: { has: activities } } : {}),
      // Decision 278 — `%`/`_` match themselves, not any text (escapeLike).
      ...(search ? { title: { contains: escapeLike(search), mode: 'insensitive' } } : {}),
      ...(includeArchived ? {} : { archivedAt: null }),
      // Class.styles is a JSON array of { disciplineId, classType }: jsonb @> finds the style.
      ...(filter.disciplineId ? { styles: { array_contains: [{ disciplineId: filter.disciplineId }] } } : {}),
      ...(filter.startsFrom || filter.startsTo
        ? { startDate: { ...(filter.startsFrom ? { gte: new Date(filter.startsFrom) } : {}), ...(filter.startsTo ? { lte: new Date(filter.startsTo) } : {}) } }
        : {}),
      ...(filter.instructorId ? { instructorId: filter.instructorId } : {}),
    };
    if (!filter.when) {
      return this.prismaApp.withTenantContext(callerId, (tx) =>
        cursorPaginate((args) => tx.class.findMany({ ...args, where }), cursor, limit),
      );
    }
    return this.findByDate(callerId, where, filter.when, cursor, limit);
  }

  /** Classes review C3: a date view, keyset-paginated on (startDate, id) so the
   * order is by start time across pages, not only within one. Upcoming means
   * not yet ended (a Class in progress still shows), soonest first; past and
   * all are latest first. */
  private async findByDate(
    callerId: string,
    base: Prisma.ClassWhereInput,
    when: 'upcoming' | 'past' | 'all',
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    const take = resolveLimit(limit);
    const now = new Date();
    const asc = when === 'upcoming';
    const dir = asc ? 'gt' : 'lt';
    let after: Prisma.ClassWhereInput = {};
    if (cursor) {
      let decoded: { sortValue: Date; id: string };
      try {
        decoded = decodeDescCursor(cursor);
      } catch {
        throw new BadRequestException('cursor is not valid for this view.');
      }
      if (Number.isNaN(decoded.sortValue.getTime())) {
        throw new BadRequestException('cursor is not valid for this view.');
      }
      after = { OR: [{ startDate: { [dir]: decoded.sortValue } }, { startDate: decoded.sortValue, id: { [dir]: decoded.id } }] };
    }
    const range: Prisma.ClassWhereInput = when === 'upcoming' ? { endDate: { gt: now } } : when === 'past' ? { endDate: { lte: now } } : {};
    const order = asc ? 'asc' : 'desc';
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findMany({ where: { AND: [base, range, after] }, orderBy: [{ startDate: order }, { id: order }], take: take + 1 }),
    );
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? encodeDescCursor(last.startDate, last.id) : null };
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
    // Classes review C11: an archived Class is read-only until unarchived.
    if (existing.archivedAt) {
      throw new ConflictException({ code: 'CLASS_ARCHIVED', message: 'This Class is archived. Unarchive it to edit it.' });
    }

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
    // null clears a cutoff, a value replaces it, omitted keeps it (C11).
    const nextCutoff = (value: string | null | undefined, current: Date | null) =>
      value === null ? null : value ? new Date(value) : current;
    const cutoffs = {
      bookingEndAt: nextCutoff(dto.bookingEndAt, existing.bookingEndAt),
      qrAttendanceEndAt: nextCutoff(dto.qrAttendanceEndAt, existing.qrAttendanceEndAt),
      refundFeeDate: nextCutoff(dto.refundFeeDate, existing.refundFeeDate),
    };
    // Checked only when the edit touches a time, so an older Class saved before
    // these checks still takes an unrelated edit (its title, say).
    if (dto.startDate || dto.endDate || dto.bookingEndAt || dto.qrAttendanceEndAt || dto.refundFeeDate) {
      this.assertValidCutoffs(nextStartDate, nextEndDate, cutoffs);
    }

    if ((dto as { styles?: unknown }).styles === null) {
      throw new BadRequestException('styles cannot be null; omit it to leave the styles unchanged.');
    }

    let seatsToOffer = 0;
    const updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Capacity can't drop below the seats already taken, and freed seats go to
      // the waitlist first (class-seats.ts; also used by Timetable slot edits).
      if (dto.capacity !== undefined) {
        seatsToOffer = await applyCapacityChange(tx, classId, dto.capacity);
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
          bookingEndAt: dto.bookingEndAt !== undefined ? cutoffs.bookingEndAt : undefined,
          qrAttendanceEndAt: dto.qrAttendanceEndAt !== undefined ? cutoffs.qrAttendanceEndAt : undefined,
          refundFeeDate: dto.refundFeeDate !== undefined ? cutoffs.refundFeeDate : undefined,
          cancellationCharge: dto.cancellationCharge,
          termsWaiverRequired: dto.termsWaiverRequired,
          membershipInclusion: dto.membershipInclusion,
        },
      });
    });
    await offerSeatsToWaitlist(this.waitlistCascadeQueue, classId, seatsToOffer, this.logger);
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

  /** Classes review C8: the extra times must fit the Class. A check-in window
   * ending before the start made check-in impossible; a booking or refund
   * cutoff after the end meant nothing. */
  private assertValidCutoffs(
    startDate: Date,
    endDate: Date,
    c: { bookingEndAt: Date | null; qrAttendanceEndAt: Date | null; refundFeeDate: Date | null },
  ) {
    if (c.qrAttendanceEndAt && c.qrAttendanceEndAt <= startDate) {
      throw new BadRequestException({ code: 'QR_WINDOW_BEFORE_START', message: 'The check-in window must end after the class starts.' });
    }
    if (c.bookingEndAt && c.bookingEndAt > endDate) {
      throw new BadRequestException({ code: 'BOOKING_CUTOFF_AFTER_END', message: 'The booking cutoff can\'t be after the class ends.' });
    }
    if (c.refundFeeDate && c.refundFeeDate > endDate) {
      throw new BadRequestException({ code: 'REFUND_CUTOFF_AFTER_END', message: 'The refund cutoff can\'t be after the class ends.' });
    }
  }
}
