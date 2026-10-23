import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PromotionFeeRequest, PromotionFeeStatus } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { RequestContext } from '../common/request-context';
import { cursorPaginate } from '../common/pagination/cursor-paginate';
import { GradingService } from './grading.service';
import { isOpenToDecide, isWaitingForFee, PendingGrade } from './promotion-fee';
import { PromotionFeeRequestQueryDto, UpdatePromotionFeeSettingsDto } from './dto/promotion-fee.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses the owner may still waive or cancel ("at any time", Decision 307). */
const OPEN_FOR_OWNER: PromotionFeeStatus[] = ['PENDING', 'ACCEPTED', 'DECLINED'];

/**
 * Promotion fee (Decisions 287, 297, 300, 303, 307, 313): the School-wide
 * switches, the requests, and what the payer and the owner do with them. The
 * fee itself is made when a coach grades (GradingService.changeRung).
 *
 * Who does what:
 * - The switches and the prices: the School owner only (Decision 297).
 * - Accept / decline: the payer — the student, or an active Guardian of the
 *   student (Decision 300 item 5), checked as for every other on-behalf
 *   action (GuardiansService.assertGuardianOfStudent).
 * - Waive / cancel: the School owner only (Decisions 300, 307 name only the
 *   owner).
 * - Dismiss a "to decide": the owner, or a coach who may promote that student
 *   in that style (Decision 307 item 3). The decisions say a coach decides
 *   "or decides not to" (Decision 313 item 1) but name no action for it; this
 *   endpoint is the narrowest one. Needs product-owner confirmation.
 * - Paying: staff-created charges (Decision 303) are not built. markPaid()
 *   is the internal step they will call; there is no endpoint for it, and no
 *   "paid at the desk" endpoint (not decided).
 *
 * Writes run under the student's own context, like every grading write
 * (Decision 88): the request's RLS lets the student's context write it, and
 * only after the checks above.
 */
@Injectable()
export class PromotionFeeService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardiansService: GuardiansService,
    private readonly gradingService: GradingService,
  ) {}

  // ---------------------------------------------------------------------------
  // The switches
  // ---------------------------------------------------------------------------

  /** Readable by the School's staff (the owner included), so the portal knows
   * whether to show prices and fee states. */
  async getSettings(callerId: string, schoolId: string) {
    this.assertUuid(schoolId, 'schoolId');
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    return this.readSettings(callerId, schoolId);
  }

  /** Owner only (Decision 297); anyone else gets 403. */
  async updateSettings(callerId: string, schoolId: string, dto: UpdatePromotionFeeSettingsDto) {
    this.assertUuid(schoolId, 'schoolId');
    if (dto.promotionFeeEnabled === undefined && dto.gradeBeforeFeePaid === undefined) {
      throw new BadRequestException('Send promotionFeeEnabled, gradeBeforeFeePaid, or both.');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          ...(dto.promotionFeeEnabled !== undefined ? { promotionFeeEnabled: dto.promotionFeeEnabled } : {}),
          ...(dto.gradeBeforeFeePaid !== undefined ? { promotionFeeGradeBeforePaid: dto.gradeBeforeFeePaid } : {}),
        },
      }),
    );
    return this.readSettings(callerId, schoolId);
  }

  private async readSettings(callerId: string, schoolId: string) {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { promotionFeeEnabled: true, promotionFeeGradeBeforePaid: true, defaultCurrency: true } }),
    );
    if (!school) throw new NotFoundException('School not found');
    return { promotionFeeEnabled: school.promotionFeeEnabled, gradeBeforeFeePaid: school.promotionFeeGradeBeforePaid, currency: school.defaultCurrency };
  }

  // ---------------------------------------------------------------------------
  // Lists
  // ---------------------------------------------------------------------------

  /** A School's requests, newest first. The owner sees all; other staff see
   * those of the students they cover on the Grading Board (the request's RLS,
   * Decisions 168, 169). */
  async listForSchool(callerId: string, schoolId: string, query: PromotionFeeRequestQueryDto, cursor?: string, limit?: number) {
    this.assertUuid(schoolId, 'schoolId');
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.promotionFeeRequest.findMany({
            ...args,
            where: {
              schoolId,
              ...(query.status ? { status: query.status } : {}),
              ...(query.studentId ? { studentId: query.studentId } : {}),
              ...(query.disciplineId ? { disciplineId: query.disciplineId } : {}),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          }),
        cursor,
        limit,
      ),
    );
    return { items: page.items.map((r) => this.shape(r)), nextCursor: page.nextCursor };
  }

  /** The student app (Decision 300 item 2): a student's own requests at every
   * School, for the student or their Guardian. Read under the student's own
   * context, as the app's other grading reads (a Guardian holds no role at
   * the School). */
  async listForStudent(callerId: string, studentId: string) {
    await this.assertPayer(callerId, studentId);
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    const rows = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.promotionFeeRequest.findMany({
        where: { studentId, ...(impersonationSchoolId ? { schoolId: impersonationSchoolId } : {}) },
        include: { school: { select: { name: true } }, discipline: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    );
    return { items: rows.map(({ school, discipline, ...r }) => ({ ...this.shape(r), schoolName: school.name, disciplineName: discipline.name })) };
  }

  // ---------------------------------------------------------------------------
  // The payer: accept or decline (Decision 300 items 2, 3, 5)
  // ---------------------------------------------------------------------------

  /** Accepting moves the request to ACCEPTED; it is then paid as a charge
   * (Decision 303, not built). A waiting promotion still waits until paid. */
  async accept(callerId: string, requestId: string) {
    return this.answer(callerId, requestId, 'ACCEPTED');
  }

  /** Declining: a promotion that applied stays; a waiting one never applies
   * on its own. The owner sees "Fee declined" (Decision 300 item 3). */
  async decline(callerId: string, requestId: string) {
    return this.answer(callerId, requestId, 'DECLINED');
  }

  /** Only an unanswered request can be answered. Declining after accepting is
   * refused: the decisions don't say the payer can change their answer, so
   * this is the narrowest reading. Needs product-owner confirmation. */
  private async answer(callerId: string, requestId: string, to: 'ACCEPTED' | 'DECLINED') {
    const request = await this.find(callerId, requestId);
    await this.assertPayer(callerId, request.studentId);
    await this.tenantAuth.assertSchoolNotArchived(request.studentId, request.schoolId);
    const now = new Date();
    const updated = await this.prismaApp.withTenantContext(request.studentId, (tx) =>
      tx.promotionFeeRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status: to, respondedById: callerId, ...(to === 'ACCEPTED' ? { acceptedAt: now } : { declinedAt: now }) },
      }),
    );
    if (updated.count === 0) {
      throw new ConflictException('This fee has already been answered, waived or cancelled.');
    }
    return this.reread(request.studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // The owner: waive or cancel at any time (Decisions 300 item 3, 307)
  // ---------------------------------------------------------------------------

  /**
   * - A promotion waiting for its fee: applied now, as the coach made it, with
   *   their grading date (Decision 307 item 4).
   * - A fee the payer declined on a promotion that never applied: nothing is
   *   applied; the promotion is "to decide" for a coach (Decision 307 item 3).
   * - A promotion that already applied: the fee is simply waived.
   */
  async waive(callerId: string, requestId: string) {
    const request = await this.findForOwner(callerId, requestId);
    if (isWaitingForFee(request)) {
      await this.gradingService.applyWaitingPromotion(callerId, request, 'WAIVED', callerId);
      return this.reread(request.studentId, request.id);
    }
    return this.close(callerId, request, 'WAIVED');
  }

  /**
   * Cancelling never promotes (Decision 307 item 3): a promotion that never
   * applied (waiting, or declined) is left "to decide" for a coach. A
   * promotion that already applied ("grade before paid" on) stays: the
   * decisions don't say a cancelled fee undoes it, and undoing it would be a
   * downgrade nobody chose. Cancelling a declined fee is treated like waiving
   * one ("to decide"). Both readings need product-owner confirmation.
   */
  async cancel(callerId: string, requestId: string) {
    const request = await this.findForOwner(callerId, requestId);
    return this.close(callerId, request, 'CANCELLED');
  }

  private async close(callerId: string, request: PromotionFeeRequest, to: 'WAIVED' | 'CANCELLED') {
    if (!OPEN_FOR_OWNER.includes(request.status)) {
      throw new ConflictException(`This fee is already ${request.status.toLowerCase()}.`);
    }
    const now = new Date();
    const neverApplied = request.promotionWaits && request.promotionEventId === null;
    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.promotionFeeRequest.updateMany({
        where: { id: request.id, status: request.status, promotionEventId: request.promotionEventId, toDecideAt: null },
        data: {
          status: to,
          closedById: callerId,
          ...(to === 'WAIVED' ? { waivedAt: now } : { cancelledAt: now }),
          // The planned promotion goes to a coach (Decision 307); the reminder clock starts (Decision 313).
          ...(neverApplied ? { toDecideAt: now } : {}),
        },
      }),
    );
    if (updated.count === 0) {
      throw new ConflictException('This fee request was changed at the same time — reload and try again.');
    }
    return this.reread(request.studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // "To decide": a coach decides not to promote (Decisions 307, 313)
  // ---------------------------------------------------------------------------

  /** The owner, or a coach who may promote this student in this style
   * (assertCanGrade with "Promote", the same people as "ready to grade").
   * Promoting is the normal Promote, fee-free (GradingService). */
  async dismiss(callerId: string, requestId: string) {
    const request = await this.find(callerId, requestId);
    if (!isOpenToDecide(request)) {
      throw new ConflictException('This promotion is not waiting for a decision.');
    }
    await this.gradingService.assertCanGrade(callerId, request.schoolId, request.disciplineId, request.studentId, 'canPromote');
    await this.tenantAuth.assertSchoolNotArchived(callerId, request.schoolId);
    const updated = await this.prismaApp.withTenantContext(request.studentId, (tx) =>
      tx.promotionFeeRequest.updateMany({
        where: { id: request.id, toDecideAt: { not: null }, toDecideResolvedAt: null },
        data: { toDecideResolvedAt: new Date(), toDecideResolution: 'DISMISSED', toDecideResolvedById: callerId },
      }),
    );
    if (updated.count === 0) {
      throw new ConflictException('This promotion was decided at the same time — reload to see what happened.');
    }
    return this.reread(request.studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // Payment (Decision 303) — internal only
  // ---------------------------------------------------------------------------

  /**
   * An accepted fee has been paid. For staff-created charges (Decision 303)
   * to call once they exist: there is deliberately no endpoint. A promotion
   * that waited for this fee applies now, with the coach's grading date, once
   * only (GradingService.applyWaitingPromotion); otherwise the request is
   * just marked paid.
   */
  async markPaid(studentId: string, requestId: string) {
    const request = await this.prismaApp.withTenantContext(studentId, (tx) => tx.promotionFeeRequest.findFirst({ where: { id: requestId, studentId } }));
    if (!request) throw new NotFoundException('Fee request not found');
    if (request.status !== 'ACCEPTED') {
      throw new ConflictException('Only an accepted fee can be paid.');
    }
    if (isWaitingForFee(request)) {
      await this.gradingService.applyWaitingPromotion(studentId, request, 'PAID');
    } else {
      const updated = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.promotionFeeRequest.updateMany({ where: { id: request.id, status: 'ACCEPTED' }, data: { status: 'PAID', paidAt: new Date() } }),
      );
      if (updated.count === 0) throw new ConflictException('This fee request was changed at the same time.');
    }
    return this.reread(studentId, request.id);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** A request the caller can see (the request's RLS: owner, the student, a
   * Guardian, or staff who cover the student). Anything else is a 404, so
   * another School learns nothing. */
  private async find(callerId: string, requestId: string): Promise<PromotionFeeRequest> {
    this.assertUuid(requestId, 'id');
    const request = await this.prismaApp.withTenantContext(callerId, (tx) => tx.promotionFeeRequest.findUnique({ where: { id: requestId } }));
    if (!request) throw new NotFoundException('Fee request not found');
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    if (impersonationSchoolId && impersonationSchoolId !== request.schoolId) throw new NotFoundException('Fee request not found');
    return request;
  }

  private async findForOwner(callerId: string, requestId: string): Promise<PromotionFeeRequest> {
    const request = await this.find(callerId, requestId);
    try {
      await this.tenantAuth.assertSchoolOwner(callerId, request.schoolId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      throw new ForbiddenException('Only the School owner can waive or cancel a promotion fee.');
    }
    await this.tenantAuth.assertSchoolNotArchived(callerId, request.schoolId);
    return request;
  }

  /** The student, or an active Guardian of the student. */
  private async assertPayer(callerId: string, studentId: string): Promise<void> {
    this.assertUuid(studentId, 'id');
    if (callerId === studentId) return;
    try {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      throw new ForbiddenException('Only the student, or their Guardian, can see and answer their promotion fees.');
    }
  }

  private async reread(studentId: string, requestId: string) {
    const row = await this.prismaApp.withTenantContext(studentId, (tx) => tx.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } }));
    return this.shape(row);
  }

  private assertUuid(value: string, name: string) {
    if (!UUID_PATTERN.test(value ?? '')) throw new BadRequestException(`${name} must be a valid UUID`);
  }

  /** The response shape (PromotionFeeRequestResponseDto). The planned grade
   * itself stays internal; its grading date is shown. */
  shape(r: PromotionFeeRequest) {
    const pg = r.pendingGrade as unknown as PendingGrade | null;
    return {
      id: r.id,
      schoolId: r.schoolId,
      studentId: r.studentId,
      disciplineId: r.disciplineId,
      toRungId: r.toRungId,
      toRungName: r.toRungName,
      expectedCurrentRungId: r.expectedCurrentRungId,
      amountMinor: r.amountMinor,
      currency: r.currency,
      status: r.status,
      promotionWaits: r.promotionWaits,
      promotionApplied: r.promotionEventId !== null,
      promotionEventId: r.promotionEventId,
      gradingDate: pg?.effectiveDate ?? null,
      toDecide: isOpenToDecide(r),
      toDecideAt: r.toDecideAt,
      toDecideResolution: r.toDecideResolution,
      acceptedAt: r.acceptedAt,
      declinedAt: r.declinedAt,
      paidAt: r.paidAt,
      waivedAt: r.waivedAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
    };
  }
}
