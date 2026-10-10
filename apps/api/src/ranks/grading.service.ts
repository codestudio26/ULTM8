import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { RanksService } from './ranks.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { DeclareRankDto, DowngradeActionDto, EditRankDateDto, GradingActionDto, VerifyRankDto, VoidPromotionEventDto } from './dto/grading-action.dto';
import { RequestContext } from '../common/request-context';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { startOfLocalDay, studentEligibility, studentTimeZone } from './grading-eligibility';
import { loadLadder } from './grading-attendance';
import { dayNumber, gradingDateProblem, localDay, requirementFor, Rung, rungIndex } from './engine';

// Same shape PrismaAppService#withTenantContext hands its callback — see that
// method's own comment for why $transaction/etc are deliberately omitted.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// History entries that move a student to a different rung. ADJUSTMENT entries
// (board drags, rank-date corrections) do not.
const RANK_CHANGE_TYPES = ['PROMOTION', 'DOWNGRADE', 'STRIPE_AWARD', 'BULK_PROMOTION', 'BULK_STRIPE_AWARD', 'SELF_DECLARED', 'RANK_CORRECTION'] as const;


// Same pattern MembershipsService.getMembershipStatus() uses for its :id check.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phase 10b scope only: single-Student grading actions (promote/downgrade/
 * stripe-award/skill-sign-off) + reads (ranks, eligibility, rank-history).
 * Bulk-promote/bulk-stripe-award are deferred (Phase 10b kickoff prompt §1.d) —
 * not built here, even partially. Booking-time rank-gating enforcement is out of
 * scope (Booking doesn't exist yet — Phase 11).
 *
 * RLS shape for StudentRank/StudentRankSkillStatus/PromotionEvent: the narrow
 * "School Owner/Manager or the row's own Student" shape (this phase's migration —
 * resolved as a direct product decision, 2026-09-09, same reasoning Phase 9 used
 * for Membership/Transaction). Every read/write method below that acts on behalf
 * of a Staff caller (not the Student themselves) FIRST calls
 * TenantAuthorizationService.assertStaffAtSchool() to authorize the caller, then
 * runs the actual Prisma operation under the TARGET Student's own tenant context
 * (studentId, not callerId) — the exact mechanism Phase 9 already built for GET
 * /students/{id}/membership-status. This is deliberate and load-bearing: running
 * these queries under callerId instead would silently return zero rows for any
 * Staff caller, the same bug Phase 9's own review caught once already.
 */
@Injectable()
export class GradingService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly ranksService: RanksService,
    private readonly guardiansService: GuardiansService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findRanksForStudent(callerId: string, studentId: string, schoolId: string): Promise<CursorPage<{ id: string }>> {
    await this.assertCallerCanReadStudent(callerId, studentId, schoolId);
    return this.prismaApp.withTenantContext(studentId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.studentRank.findMany({
            ...args,
            where: { studentId, schoolId },
            include: { skillStatuses: { select: { skillId: true, status: true } } },
          }),
        undefined,
        undefined,
      ),
    );
  }

  /** The rank list plus each style's readiness for its next rung, from the
   * grading engine: Gus's progress formula and the 33% / 66% board columns
   * (Decisions 75, 136). Same readers as the rank list (Decision 132). */
  async findEligibilityForStudent(callerId: string, studentId: string, schoolId: string) {
    const page = await this.findRanksForStudent(callerId, studentId, schoolId);
    // Readiness from the grading engine (roadmap Phase 2c): the same fields as
    // the rank list, plus each style's eligibility for its next rung.
    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const timeZone = await studentTimeZone(tx, studentId, schoolId);
      const items: Array<Record<string, unknown>> = [];
      for (const row of page.items as Array<Parameters<typeof studentEligibility>[1] & { id: string }>) {
        items.push({ ...row, eligibility: await studentEligibility(tx, row, timeZone) });
      }
      return { items };
    });
  }

  /** Voided entries are hidden from the normal history (Decision 129). Staff
   * may ask for them with `includeVoided`; a Student or Guardian may not. */
  async findRankHistoryForStudent(
    callerId: string,
    studentId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
    includeVoided = false,
  ): Promise<CursorPage<{ id: string }>> {
    const relation = await this.assertCallerCanReadStudent(callerId, studentId, schoolId);
    if (includeVoided && relation !== 'staff') {
      throw new ForbiddenException('Only School staff can see voided history entries.');
    }
    return this.prismaApp.withTenantContext(studentId, (tx) =>
      cursorPaginate(
        (args) => tx.promotionEvent.findMany({ ...args, where: { studentId, schoolId, ...(includeVoided ? {} : { voidedAt: null }) } }),
        cursor,
        limit,
      ),
    );
  }

  /** Staff (Owner/Manager/Branch Staff/Instructor), the Student themselves, OR
   * an active Guardian of the Student (Decision 132: "A Guardian can read, but
   * not change, each linked minor's ranks, progress, skills for the next grade
   * and rank history"). `schoolId` is a required parameter for the same reason
   * GET /students/{id}/membership-status needed one in Phase 9 — a Student's
   * StudentRank rows are School-scoped, and without it this can't know which
   * School's data to read.
   *
   * The Guardian path reuses GuardiansService.assertGuardianOfStudent(), the
   * same check waivers/memberships/bookings already use for on-behalf-of
   * actions. The read itself still runs under the Student's own tenant context
   * (every caller of this method does so), so StudentRank's narrow RLS shape
   * (Decision 88) is unchanged — nothing is broadened at the database level.
   * Only a ForbiddenException from the staff check falls through to the
   * Guardian check; any other error propagates as-is.
   *
   * FOUND ON INDEPENDENT REVIEW (grading foundation PR 1), pre-existing: with
   * no `schoolId`, assertStaffAtSchool() matched ANY staff grant (Prisma drops
   * an `undefined` filter) and the read below then returned the Student's rows
   * from EVERY School — a cross-tenant read for any Student id a staff member
   * knew. Now required, with the same explicit schoolId/UUID checks GET
   * /students/{id}/membership-status already applies.
   *
   * Impersonation (Decision 102 / Spec 55 Decision 39): a Support session is
   * scoped to one School. The Student/Guardian paths below read under the
   * Student's own tenant context, which the RoleGrant-based impersonation RLS
   * narrowing does not reach, so a session scoped to School A is refused for
   * any other schoolId here, explicitly. */
  private async assertCallerCanReadStudent(callerId: string, studentId: string, schoolId: string): Promise<'self' | 'staff' | 'guardian'> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    if (!UUID_PATTERN.test(studentId) || !UUID_PATTERN.test(schoolId)) {
      throw new BadRequestException('id path parameter and schoolId must be valid UUIDs');
    }
    const impersonationSchoolId = RequestContext.getImpersonationSchoolId();
    if (impersonationSchoolId && impersonationSchoolId !== schoolId) {
      throw new ForbiddenException('This impersonation session is scoped to a different School.');
    }
    if (callerId === studentId) return 'self';
    try {
      await this.assertStaffCanSeeStudent(callerId, schoolId, studentId);
      return 'staff';
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
    }
    try {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      // Neutral wording: the caller may be a peer Student, staff at another
      // School or an outsider, not necessarily a would-be Guardian.
      throw new ForbiddenException('You may not view this Student\'s grading.');
    }
    return 'guardian';
  }

  // ---------------------------------------------------------------------------
  // Who may grade, and whose grading staff may see (grading foundation PR 4,
  // Decisions 138, 139, 148, 168)
  // ---------------------------------------------------------------------------

  private async isSchoolOwner(callerId: string, schoolId: string): Promise<boolean> {
    try {
      await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
    }
  }

  /** Decision 138: the School owner always may grade. Anyone else must be
   * School staff (Instructor or Branch Staff) holding grading permission for
   * this discipline, and the student must be in one of their branches
   * (Decision 168). Covers every grading write: grade, downgrade, stripe
   * award, skill sign-off, void and edit rank date. Replaces the plain
   * assertStaffAtSchool() check, which admitted all staff to every grading
   * action and was flagged [UNRESOLVED] in this file. */
  async assertCanGrade(callerId: string, schoolId: string, disciplineId: string, studentId: string): Promise<void> {
    if (await this.isSchoolOwner(callerId, schoolId)) return;
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const permission = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.gradingPermission.findUnique({ where: { userId_disciplineId: { userId: callerId, disciplineId } }, select: { schoolId: true } }),
    );
    if (!permission || permission.schoolId !== schoolId) {
      throw new ForbiddenException('You do not have grading permission for this style. The School owner grants it.');
    }
    await this.assertBranchCoversStudent(callerId, schoolId, studentId);
  }

  /** Reads: the owner sees every student; other staff see the students of
   * their own branches, with or without grading permission (Decision 168). */
  private async assertStaffCanSeeStudent(callerId: string, schoolId: string, studentId: string): Promise<void> {
    if (await this.isSchoolOwner(callerId, schoolId)) return;
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.assertBranchCoversStudent(callerId, schoolId, studentId);
  }

  /** Decision 168 (with 139 and 148):
   * - A School with no branches is one branch: every staff member covers
   *   every student.
   * - In a School with branches, staff cover the students whose home branch
   *   is one of the branches they are assigned to (one staff RoleGrant per
   *   branch; a coach may hold several). A staff grant with no branch covers
   *   no students there, and a student with no home branch yet is the
   *   owner's alone until the owner assigns one. */
  private async assertBranchCoversStudent(callerId: string, schoolId: string, studentId: string): Promise<void> {
    // Under the caller's context, Branch RLS shows a staff member at least
    // their own branch, so any row means the School has branches.
    const anyBranch = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findFirst({ where: { schoolId }, select: { id: true } }),
    );
    if (!anyBranch) return;

    const home = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.studentHomeBranch.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { branchId: true } }),
    );
    if (!home) {
      throw new ForbiddenException('This student has no home branch yet. Only the School owner can see or grade them until one is assigned.');
    }
    const assignment = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({
        where: { userId: callerId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null, branchId: home.branchId },
        select: { id: true },
      }),
    );
    if (!assignment) {
      throw new ForbiddenException('This student belongs to a branch you are not assigned to.');
    }
  }

  /** Every grading WRITE (promote, downgrade, stripe award, skill sign-off)
   * runs these two School-level gates after the caller is authorized:
   * - Decision 87: School.ranksToggle is a real backend write-gate on "every
   *   RanksModule endpoint that CREATES or MODIFIES rank data (... promote/
   *   downgrade/stripe-award, skill sign-off)". Previously only the catalog
   *   writes in RanksService applied it.
   * - Decision 110: a closed (archived) School accepts no new or updated
   *   records — the same check RanksService/CurriculumService writes apply.
   * Reads are deliberately not gated (grading history stays readable). */
  private async assertSchoolAcceptsGradingWrites(callerId: string, schoolId: string): Promise<void> {
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.ranksService.assertRanksEnabled(callerId, schoolId);
  }

  // ---------------------------------------------------------------------------
  // Grading actions — coach-initiated only (Spec 55 §5: "grading is always
  // coach-initiated, never automatic"). Who may grade is assertCanGrade()
  // above: the owner always, anyone else per discipline as the owner grants,
  // for the students of their own branches (Decisions 138, 168). This
  // resolves the [UNRESOLVED] note that used to stand here about
  // assertStaffAtSchool() admitting every staff member to every action.
  // ---------------------------------------------------------------------------

  async promote(callerId: string, studentId: string, disciplineId: string, dto: GradingActionDto) {
    return this.changeRung(callerId, studentId, disciplineId, dto, 'PROMOTION');
  }

  async downgrade(callerId: string, studentId: string, disciplineId: string, dto: DowngradeActionDto) {
    return this.changeRung(callerId, studentId, disciplineId, dto, 'DOWNGRADE');
  }

  /** Spec 55 §5 (quoted): "unavailable once the Student is at a belt's highest
   * configured stripe tier" — a distinct, coach-initiated action from promote,
   * never system-triggered. Moves to the next stripe tier of the same belt. */
  async stripeAward(callerId: string, studentId: string, disciplineId: string, dto: GradingActionDto) {
    return this.changeRung(callerId, studentId, disciplineId, dto, 'STRIPE_AWARD');
  }

  /**
   * The single way a coach moves a student to another rung, as the
   * prototype's applyRankChange (roadmap Phase 3a; Decisions 126–128, 167,
   * 174). Every change writes one history entry and resets the same things:
   * the time-in-rank clock, the class count (to the starting classes), the
   * per-type tally, when counting began, and the skill sign-offs.
   *
   * - Promote: up only, to any higher rung (skipped rungs are recorded,
   *   "Skipped N ranks in between"); default the next belt's first rung, as
   *   before. Downgrade: down only, to any lower rung, with a reason, dated
   *   today; default the previous belt's first rung. Stripe award: the next
   *   stripe tier of the same belt.
   * - Skills (Decision 127): the engine's requirement for the student's next
   *   rung. Not all signed off: blocked when the style's "skills required"
   *   switch is on, otherwise allowed with the written acknowledgement
   *   (Decision 128, item 10). Not checked on a downgrade or a time-only rung.
   * - Back-dated grading (Decision 128, item 8): a local day, not in the
   *   future and not before the current rank date.
   * - Starting classes (Decision 128, item 9): one number when the new next
   *   rung counts any type; a number per type when it counts each type
   *   (Decision 174); none on a time-only rung.
   *
   * Promotion-notification wiring (grading foundation gap closed independently
   * of this phase's own roadmap): after a successful PROMOTION/DOWNGRADE/
   * STRIPE_AWARD, notifies the Student directly via NOTIFICATION_FANOUT_QUEUE
   * (the same @InjectQueue-from-a-plain-HTTP-service pattern BookingsService/
   * WaiversService/PaymentsService already use) — see
   * notifyStudentOfGradingAction's own comment for why this is scoped to
   * these three types only.
   */
  private async changeRung(
    callerId: string,
    studentId: string,
    disciplineId: string,
    dto: GradingActionDto & { reason?: string },
    type: 'PROMOTION' | 'DOWNGRADE' | 'STRIPE_AWARD',
  ) {
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    if (type === 'DOWNGRADE' && (dto.effectiveDate !== undefined || dto.startingClasses !== undefined || dto.startingClassesByType !== undefined)) {
      throw new BadRequestException('A downgrade is dated today and starts with no classes; effectiveDate and starting classes are for grading up.');
    }
    if (type === 'STRIPE_AWARD' && dto.targetRungId !== undefined) {
      throw new BadRequestException('A stripe award moves to the next stripe tier; to grade to a chosen rung, use promote with targetRungId.');
    }

    const result = await this.prismaApp.withTenantContext(studentId, async (tx) => {
      const existing = await tx.studentRank.findUnique({
        where: { studentId_disciplineId: { studentId, disciplineId } },
        include: { skillStatuses: true },
      });
      const ladder = await loadLadder(tx, disciplineId);
      if (ladder.length === 0) {
        throw new BadRequestException('This Discipline has no Ranks configured yet.');
      }
      const timeZone = await studentTimeZone(tx, studentId, discipline.schoolId);
      const today = localDay(new Date(), timeZone);

      // --- Where from, where to.
      const fromIndex = existing?.currentStripeId ? rungIndex(ladder, existing.currentStripeId) : -1;
      if (existing && fromIndex < 0) {
        throw new BadRequestException('This Student\'s current rung can\'t be found on the ladder; correct their rank first.');
      }
      if (!existing && type !== 'PROMOTION') {
        throw new BadRequestException(
          type === 'DOWNGRADE'
            ? 'This Student has no existing rank in this Discipline to downgrade from.'
            : 'This Student has no existing rank in this Discipline to award a stripe within.',
        );
      }
      const from = existing ? ladder[fromIndex] : null;
      let toIndex: number;
      if (dto.targetRungId !== undefined) {
        toIndex = rungIndex(ladder, dto.targetRungId);
        if (toIndex < 0) throw new BadRequestException('targetRungId is not a rung of this style.');
        if (from && type === 'PROMOTION' && toIndex <= fromIndex) {
          throw new BadRequestException('Promote only moves up; pick a higher rung (Decision 128, item 12). Use downgrade to move down.');
        }
        if (from && type === 'DOWNGRADE' && toIndex >= fromIndex) {
          throw new BadRequestException('Downgrade only moves down; pick a lower rung (Decision 128, item 12).');
        }
      } else if (!from) {
        toIndex = 0; // a first grade starts on the style's first rung
      } else if (type === 'STRIPE_AWARD') {
        toIndex = fromIndex + 1;
        if (!ladder[toIndex] || ladder[toIndex].rankId !== from.rankId) {
          throw new BadRequestException('This Student is already at the highest configured stripe tier for this Rank.');
        }
      } else {
        // Default: the first rung of the next (or previous) belt, as before.
        const step = type === 'PROMOTION' ? 1 : -1;
        const targetRankOrder = from.rankOrder + step;
        toIndex = ladder.findIndex((r) => r.rankOrder === targetRankOrder);
        if (toIndex < 0) {
          throw new BadRequestException(
            type === 'PROMOTION' ? 'This Student is already at the highest Rank in this Discipline.' : 'This Student is already at the lowest Rank in this Discipline.',
          );
        }
      }
      const to = ladder[toIndex];

      // --- Skills for the student's next rung (Decision 127).
      let missingSkillIds: string[] = [];
      if (from && type !== 'DOWNGRADE') {
        const req = requirementFor(ladder, from.id);
        if (req.kind === 'NEXT' && !req.timeOnly) {
          const signed = new Set(existing!.skillStatuses.filter((s) => s.status === 'SIGNED_OFF').map((s) => s.skillId));
          missingSkillIds = req.requiredSkillIds.filter((id) => !signed.has(id));
        }
      }
      if (missingSkillIds.length > 0) {
        if (discipline.skillsRequiredToGrade) {
          throw new BadRequestException(
            'This style requires every skill for the next rank to be signed off before grading (Decision 128, item 10). Not signed off yet: ' +
              missingSkillIds.join(', '),
          );
        }
        if (!dto.acknowledgeWithoutSkillSignoff) {
          throw new BadRequestException(
            'This Student has required Skills for their next rank not yet Signed Off. Set acknowledgeWithoutSkillSignoff=true to grade anyway (always recorded).',
          );
        }
      }

      // --- The grading date.
      let rankDate = new Date();
      if (dto.effectiveDate !== undefined) {
        const problem = gradingDateProblem(dto.effectiveDate, today, existing ? localDay(existing.dateOfCurrentRank, timeZone) : null);
        if (problem === 'INVALID') throw new BadRequestException('effectiveDate must be a real calendar date, as YYYY-MM-DD.');
        if (problem === 'IN_FUTURE') throw new BadRequestException('The grading date can\'t be in the future.');
        if (problem === 'BEFORE_CURRENT_RANK') {
          throw new BadRequestException(
            `The grading date can't be before the date the student reached their current rank, ${localDay(existing!.dateOfCurrentRank, timeZone)} (Decision 128, item 8).`,
          );
        }
        if (dto.effectiveDate !== today) rankDate = startOfLocalDay(dto.effectiveDate, timeZone);
      }

      // --- Starting classes toward the new next rung.
      const { total: startingTotal, byType: startingByType } = this.startingClasses(ladder, to, dto);

      // --- Write.
      const now = new Date();
      const counters = {
        currentRankId: to.rankId,
        currentStripeId: to.id,
        dateOfCurrentRank: rankDate,
        classesAttendedTowardCheckpoint: startingTotal,
        classesAttendedByType: startingByType ?? {},
        countingSince: now,
      };
      let studentRank;
      if (existing) {
        // Conditional on the rung read above, so a concurrent grading action
        // gets a clean 409 instead of silently overwriting this one.
        const updated = await tx.studentRank.updateMany({
          where: { id: existing.id, currentRankId: existing.currentRankId, currentStripeId: existing.currentStripeId },
          data: counters,
        });
        if (updated.count === 0) {
          throw new ConflictException('This Student\'s rank was changed by a concurrent grading action — please retry.');
        }
        studentRank = await tx.studentRank.findUniqueOrThrow({ where: { id: existing.id } });
        // Skill sign-offs belong to the old rung (Decision 128, item 16).
        await tx.studentRankSkillStatus.deleteMany({ where: { studentRankId: existing.id } });
      } else {
        studentRank = await tx.studentRank.create({
          data: { id: randomUUID(), studentId, disciplineId, schoolId: discipline.schoolId, ...counters },
        });
      }

      const skipped = from && type === 'PROMOTION' ? toIndex - fromIndex - 1 : 0;
      const promotionEvent = await tx.promotionEvent.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: discipline.schoolId,
          studentId,
          type,
          performedById: callerId,
          fromRankId: from?.rankId ?? null,
          toRankId: to.rankId,
          fromStripeTierId: from?.id ?? null,
          toStripeTierId: to.id,
          acknowledgedWithoutSkillSignoff: missingSkillIds.length > 0,
          effectiveDate: rankDate,
          // Required on a downgrade by DowngradeActionDto (Decision 128, item 11).
          reason: type === 'DOWNGRADE' ? dto.reason : null,
          note: dto.note ?? null,
          rungsSkipped: Math.max(0, skipped),
          systemNote: skipped > 0 ? `Skipped ${skipped} rank${skipped > 1 ? 's' : ''} in between.` : null,
          startingClasses: type === 'DOWNGRADE' ? null : startingTotal,
          startingClassesByType: startingByType ?? undefined,
        },
      });

      return { studentRank, promotionEvent, toRungName: to.name };
    });

    await this.notifyStudentOfGradingAction(
      studentId,
      discipline.name,
      result.promotionEvent.id,
      type === 'STRIPE_AWARD' ? 'New stripe!' : type === 'PROMOTION' ? 'Promoted!' : 'Rank updated',
      type === 'STRIPE_AWARD'
        ? `You've earned ${result.toRungName}.`
        : type === 'PROMOTION'
          ? `You've been promoted to ${result.toRungName}.`
          : `Your rank has been adjusted to ${result.toRungName}.`,
    );

    return result;
  }

  /** Starting classes toward the rung after `to` (Decision 128, item 9;
   * Decision 174): a number per type when that rung counts each type, one
   * number otherwise; none when `to` is time-only (classes aren't counted). */
  private startingClasses(
    ladder: Rung[],
    to: Rung,
    dto: { startingClasses?: number; startingClassesByType?: Record<string, number> },
  ): { total: number; byType: Record<string, number> | null } {
    const given = dto.startingClasses !== undefined || dto.startingClassesByType !== undefined;
    if (!given) return { total: 0, byType: null };
    const req = requirementFor(ladder, to.id);
    if (to.timeOnly || (req.kind === 'NEXT' && req.timeOnly)) {
      throw new BadRequestException('The new rank counts time only, so it starts with no classes (Decision 128, item 3).');
    }
    if (req.kind === 'NEXT' && req.countRules.classCountMode === 'EACH_TYPE') {
      if (dto.startingClasses !== undefined) {
        throw new BadRequestException('The next rank counts each class type separately: send startingClassesByType, a number per type (Decision 174).');
      }
      const types = req.countRules.classTypeRequirements.map((r) => r.classType);
      const byType: Record<string, number> = {};
      for (const [classType, n] of Object.entries(dto.startingClassesByType ?? {})) {
        if (!types.includes(classType)) {
          throw new BadRequestException(`"${classType}" is not one of the next rank's class types: ${types.join(', ')}.`);
        }
        if (!Number.isInteger(n) || n < 0) {
          throw new BadRequestException('Each starting class number must be a whole number, 0 or more.');
        }
        if (n > 0) byType[classType] = n;
      }
      return { total: Object.values(byType).reduce((sum, n) => sum + n, 0), byType };
    }
    if (dto.startingClassesByType !== undefined) {
      throw new BadRequestException('The next rank counts any ticked class type: send startingClasses, one number.');
    }
    return { total: dto.startingClasses ?? 0, byType: null };
  }

  /** Promotion-notification wiring: notifies the Student directly for a
   * PROMOTION/DOWNGRADE/STRIPE_AWARD only — not SELF_DECLARED (the student's
   * own action, no one "did" it to them) and not RANK_CORRECTION/ADJUSTMENT
   * (administrative corrections, not a "you were graded" moment). */
  private async notifyStudentOfGradingAction(
    studentId: string,
    disciplineName: string,
    promotionEventId: string,
    title: string,
    body: string,
  ): Promise<void> {
    await this.notificationFanoutQueue.add(
      'notify',
      {
        notificationId: `grading-${promotionEventId}`,
        userId: studentId,
        title,
        body: `${body} (${disciplineName})`,
        type: 'GRADING_RANK_CHANGE',
      } satisfies NotificationFanoutJobData,
      { jobId: `grading-${promotionEventId}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }

  // ---------------------------------------------------------------------------
  // Skill sign-off cycling
  // ---------------------------------------------------------------------------

  /** Cycle: NOT_STARTED -> LEARNING -> SIGNED_OFF -> NOT_STARTED. Spec 55 §7 says
   * only "cycle sign-off status" — the exact direction/wrap isn't itself further
   * specified; this 3-state wrap is the reading proceeded on, flagged as
   * inferred, not asserted as settled (Phase 10b kickoff prompt §3.2). */
  async cycleSkillSignOff(callerId: string, studentId: string, skillId: string) {
    const skill = await this.prismaApp.withTenantContext(callerId, (tx) => tx.skill.findUnique({ where: { id: skillId } }));
    if (!skill) {
      throw new NotFoundException('Skill not found');
    }
    await this.assertCanGrade(callerId, skill.schoolId, skill.disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, skill.schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const studentRank = await tx.studentRank.findUnique({
        where: { studentId_disciplineId: { studentId, disciplineId: skill.disciplineId } },
      });
      if (!studentRank) {
        throw new BadRequestException('This Student has no existing rank in this Skill\'s Discipline.');
      }

      // Only the skills of the student's next rung can be signed off: the
      // engine's requirement for their current rung (Decision 127), required
      // or, after a time-only rung, optional. Anything else has nothing to
      // sign off yet.
      const req = requirementFor(await loadLadder(tx, skill.disciplineId), studentRank.currentStripeId ?? '');
      const forNextRung = req.kind === 'NEXT' ? [...req.requiredSkillIds, ...req.optionalSkillIds] : [];
      if (!forNextRung.includes(skillId)) {
        throw new BadRequestException('This Skill is not one of the skills for this Student\'s next rank.');
      }

      const existing = await tx.studentRankSkillStatus.findUnique({
        where: { studentRankId_skillId: { studentRankId: studentRank.id, skillId } },
      });
      const previous = existing?.status ?? 'NOT_STARTED';
      const next = this.nextSkillStatus(previous);

      // Decision 156: every change is logged with who, when, old and new status.
      await tx.skillSignOffLog.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: studentRank.schoolId,
          studentId,
          skillId,
          fromStatus: previous,
          toStatus: next,
          changedById: callerId,
        },
      });

      if (existing) {
        // Conditional on the status read above, so two concurrent clicks can't
        // both log the same change.
        const updated = await tx.studentRankSkillStatus.updateMany({ where: { id: existing.id, status: existing.status }, data: { status: next } });
        if (updated.count === 0) {
          throw new ConflictException('This sign-off was changed at the same time by someone else — please retry.');
        }
        return tx.studentRankSkillStatus.findUniqueOrThrow({ where: { id: existing.id } });
      }
      return tx.studentRankSkillStatus.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: studentRank.schoolId,
          studentId,
          skillId,
          status: next,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // History corrections (grading foundation PR 3)
  // ---------------------------------------------------------------------------

  /** Void a history entry with a reason (Decision 129): hidden from the normal
   * history, kept in the database with who voided it, when and why, and never
   * changes the student's current rank. Same staff check and School gates as
   * every other grading write. */
  async voidPromotionEvent(callerId: string, studentId: string, schoolId: string, eventId: string, dto: VoidPromotionEventDto) {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    if (!UUID_PATTERN.test(studentId) || !UUID_PATTERN.test(schoolId) || !UUID_PATTERN.test(eventId)) {
      throw new BadRequestException('id, eventId and schoolId must be valid UUIDs');
    }
    // Staff first, so an outsider learns nothing about which entries exist;
    // then the full grading check for the entry's own discipline.
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const found = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.promotionEvent.findFirst({ where: { id: eventId, studentId, schoolId }, select: { studentRank: { select: { disciplineId: true } } } }),
    );
    if (!found) {
      throw new NotFoundException('History entry not found');
    }
    await this.assertCanGrade(callerId, schoolId, found.studentRank.disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const entry = await tx.promotionEvent.findFirst({ where: { id: eventId, studentId, schoolId } });
      if (!entry) {
        throw new NotFoundException('History entry not found');
      }
      // Conditional on voidedAt still being empty: a second void (or two at
      // once) gets a 409, and the first reason is never overwritten.
      const result = await tx.promotionEvent.updateMany({
        where: { id: entry.id, voidedAt: null },
        data: { voidedAt: new Date(), voidedById: callerId, voidReason: dto.reason },
      });
      if (result.count === 0) {
        throw new ConflictException('This history entry has already been voided.');
      }
      return tx.promotionEvent.findUniqueOrThrow({ where: { id: entry.id } });
    });
  }

  /** Correct the date a student reached their current rung (Decision 153).
   * The new date may not be in the future, nor before the student's previous
   * grading on their (non-voided) history, so the history never runs
   * backwards (Decision 166). Updates StudentRank.dateOfCurrentRank and the
   * effective date of the entry that put the student on this rung, and writes
   * an ADJUSTMENT entry recording the old date, the new date, who and when. */
  async editRankDate(callerId: string, studentId: string, disciplineId: string, dto: EditRankDateDto) {
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    if (dayNumber(dto.date) === null) {
      throw new BadRequestException('date must be a real calendar date, as YYYY-MM-DD.');
    }

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      // Days are the student's local days (home branch, else School, else
      // UTC), the same days the engine counts time in rank with.
      const timeZone = await studentTimeZone(tx, studentId, discipline.schoolId);
      const dayOf = (d: Date) => localDay(d, timeZone);
      if (dto.date > dayOf(new Date())) {
        throw new BadRequestException('The rank date can\'t be in the future.');
      }
      const newDate = startOfLocalDay(dto.date, timeZone);
      const existing = await tx.studentRank.findUnique({ where: { studentId_disciplineId: { studentId, disciplineId } } });
      if (!existing) {
        throw new BadRequestException('This Student has no rank in this Discipline.');
      }
      const oldDay = dayOf(existing.dateOfCurrentRank);
      if (oldDay === dto.date) {
        throw new BadRequestException('That is already the student\'s rank date.');
      }

      const recent = await tx.promotionEvent.findMany({
        where: { studentRankId: existing.id, voidedAt: null, type: { in: [...RANK_CHANGE_TYPES] } },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        take: 2,
      });
      const currentEntry =
        recent[0] && recent[0].toRankId === existing.currentRankId && recent[0].toStripeTierId === existing.currentStripeId ? recent[0] : null;
      const previousEntry = currentEntry ? recent[1] : recent[0];
      if (previousEntry && dto.date < dayOf(previousEntry.effectiveDate)) {
        throw new BadRequestException(
          `The rank date can't be before the student's previous grading on ${dayOf(previousEntry.effectiveDate)} (Decision 166).`,
        );
      }

      // Same optimistic-concurrency shape as the grading actions above: a
      // grading or another correction in between gets a 409, not a silent overwrite.
      const updated = await tx.studentRank.updateMany({
        where: {
          id: existing.id,
          currentRankId: existing.currentRankId,
          currentStripeId: existing.currentStripeId,
          dateOfCurrentRank: existing.dateOfCurrentRank,
        },
        data: { dateOfCurrentRank: newDate },
      });
      if (updated.count === 0) {
        throw new ConflictException('This Student\'s rank was changed at the same time — please retry.');
      }
      if (currentEntry) {
        await tx.promotionEvent.update({ where: { id: currentEntry.id }, data: { effectiveDate: newDate } });
      }
      const promotionEvent = await tx.promotionEvent.create({
        data: {
          id: randomUUID(),
          studentRankId: existing.id,
          schoolId: existing.schoolId,
          studentId,
          type: 'ADJUSTMENT',
          performedById: callerId,
          fromRankId: existing.currentRankId,
          toRankId: existing.currentRankId,
          fromStripeTierId: existing.currentStripeId,
          toStripeTierId: existing.currentStripeId,
          systemNote: `Rank date corrected from ${oldDay} to ${dto.date}.`,
          note: dto.note ?? null,
        },
      });
      const studentRank = await tx.studentRank.findUniqueOrThrow({ where: { id: existing.id } });
      return { studentRank, promotionEvent };
    });
  }

  private nextSkillStatus(current: string): 'NOT_STARTED' | 'LEARNING' | 'SIGNED_OFF' {
    if (current === 'NOT_STARTED') return 'LEARNING';
    if (current === 'LEARNING') return 'SIGNED_OFF';
    return 'NOT_STARTED';
  }

  // ---------------------------------------------------------------------------
  // Self-declared ranks (grading foundation PR 6, Decisions 137, 147)
  // ---------------------------------------------------------------------------

  /** A student (or their guardian, for a minor) declares the rung they hold in
   * a style when joining the School (Decision 137). Stored UNVERIFIED, except
   * the style's first rung (lowest belt, no stripe), which is verified
   * automatically (Decision 147). Only for a style where the student has no
   * rank yet. Written under the student's own tenant context, like every
   * other StudentRank write. An unverified rank still counts as the student's
   * rank for booking (Decision 137, item 3), which the booking rank gate
   * already does: it does not look at verification. */
  async declareRank(callerId: string, studentId: string, disciplineId: string, dto: DeclareRankDto) {
    if (!UUID_PATTERN.test(studentId) || !UUID_PATTERN.test(disciplineId)) {
      throw new BadRequestException('id and disciplineId must be valid UUIDs');
    }
    if (callerId !== studentId) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    }
    const discipline = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.discipline.findUnique({ where: { id: disciplineId }, select: { id: true, schoolId: true } }),
    );
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    const enrolled = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findFirst({
        where: { userId: studentId, schoolId: discipline.schoolId, role: 'STUDENT', revokedAt: null },
        select: { id: true },
      }),
    );
    if (!enrolled) {
      throw new ForbiddenException('Only a Student of this School can declare a rank here.');
    }
    await this.assertSchoolAcceptsGradingWrites(studentId, discipline.schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const tier = await tx.rankStripeTier.findFirst({
        where: { id: dto.stripeTierId, rankId: dto.rankId, rank: { disciplineId } },
        select: { id: true, rankId: true },
      });
      if (!tier) {
        throw new BadRequestException('rankId and stripeTierId must be a belt of this style and one of its rungs.');
      }
      if (await tx.studentRank.findUnique({ where: { studentId_disciplineId: { studentId, disciplineId } }, select: { id: true } })) {
        throw new ConflictException('This student already has a rank in this style; only staff can change it.');
      }

      // The style's first rung: its lowest belt's lowest rung.
      const firstRank = await tx.rank.findFirst({ where: { disciplineId }, orderBy: { order: 'asc' }, select: { id: true } });
      const firstTier = firstRank
        ? await tx.rankStripeTier.findFirst({ where: { rankId: firstRank.id }, orderBy: { order: 'asc' }, select: { id: true } })
        : null;
      const autoVerified = tier.id === firstTier?.id;
      const now = new Date();

      let studentRank;
      try {
        studentRank = await tx.studentRank.create({
          data: {
            id: randomUUID(),
            studentId,
            disciplineId,
            schoolId: discipline.schoolId,
            currentRankId: tier.rankId,
            currentStripeId: tier.id,
            verificationStatus: autoVerified ? 'VERIFIED' : 'UNVERIFIED',
            verifiedAt: autoVerified ? now : null,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('This student already has a rank in this style; only staff can change it.');
        }
        throw err;
      }
      const promotionEvent = await tx.promotionEvent.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: discipline.schoolId,
          studentId,
          type: 'SELF_DECLARED',
          performedById: callerId,
          toRankId: tier.rankId,
          toStripeTierId: tier.id,
          systemNote: autoVerified
            ? 'Declared when joining: the first rung, verified automatically (Decision 147).'
            : 'Declared when joining: waiting to be verified by the School (Decision 137).',
        },
      });
      return { studentRank, promotionEvent };
    });
  }

  /** Verify a self-declared rank, or correct it to the right rung while
   * verifying (Decision 147). Same permission as grading: the owner, or staff
   * with grading permission for this style and the student's branch
   * (Decisions 138, 168). A correction is written to the history with who,
   * from what, to what and when. */
  async verifyRank(callerId: string, studentId: string, disciplineId: string, dto: VerifyRankDto) {
    if ((dto.rankId === undefined) !== (dto.stripeTierId === undefined)) {
      throw new BadRequestException('To correct the rank, send both rankId and stripeTierId.');
    }
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const existing = await tx.studentRank.findUnique({ where: { studentId_disciplineId: { studentId, disciplineId } } });
      if (!existing) {
        throw new BadRequestException('This student has no rank in this style to verify.');
      }
      if (existing.verificationStatus === 'VERIFIED') {
        throw new ConflictException('This rank is already verified.');
      }

      let target = { rankId: existing.currentRankId, stripeTierId: existing.currentStripeId };
      if (dto.rankId && dto.stripeTierId) {
        const tier = await tx.rankStripeTier.findFirst({
          where: { id: dto.stripeTierId, rankId: dto.rankId, rank: { disciplineId } },
          select: { id: true, rankId: true },
        });
        if (!tier) {
          throw new BadRequestException('rankId and stripeTierId must be a belt of this style and one of its rungs.');
        }
        target = { rankId: tier.rankId, stripeTierId: tier.id };
      }
      const corrected = target.rankId !== existing.currentRankId || target.stripeTierId !== existing.currentStripeId;

      // Conditional on what was read, like every grading write: a concurrent
      // verification or grading gets a 409, not a silent overwrite.
      const updated = await tx.studentRank.updateMany({
        where: {
          id: existing.id,
          currentRankId: existing.currentRankId,
          currentStripeId: existing.currentStripeId,
          verificationStatus: 'UNVERIFIED',
        },
        data: {
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
          verifiedById: callerId,
          currentRankId: target.rankId,
          currentStripeId: target.stripeTierId,
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('This rank was changed at the same time — please retry.');
      }

      let promotionEvent: Prisma.PromotionEventGetPayload<object> | null = null;
      if (corrected) {
        // A different rung: sign-offs belong to the old one (Decision 128, item 16).
        await tx.studentRankSkillStatus.deleteMany({ where: { studentRankId: existing.id } });
        promotionEvent = await tx.promotionEvent.create({
          data: {
            id: randomUUID(),
            studentRankId: existing.id,
            schoolId: existing.schoolId,
            studentId,
            type: 'RANK_CORRECTION',
            performedById: callerId,
            fromRankId: existing.currentRankId,
            toRankId: target.rankId,
            fromStripeTierId: existing.currentStripeId,
            toStripeTierId: target.stripeTierId,
            systemNote: 'Self-declared rank corrected while verifying (Decision 147).',
            note: dto.note ?? null,
          },
        });
      }
      const studentRank = await tx.studentRank.findUniqueOrThrow({ where: { id: existing.id } });
      return { studentRank, promotionEvent };
    });
  }

  /** Ranks waiting to be verified at a School, for the notice shown at login
   * (Decision 137, item 4). Owner only for now: StudentRank's RLS (Decision
   * 88) lets only the owner list other students' ranks. Permitted coaches get
   * their branches' list with the Grading Board's read path (roadmap Phase 3). */
  async findPendingVerifications(callerId: string, schoolId: string) {
    if (!UUID_PATTERN.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const items = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.studentRank.findMany({
        where: { schoolId, verificationStatus: 'UNVERIFIED' },
        orderBy: { createdAt: 'asc' },
        include: { skillStatuses: { select: { skillId: true, status: true } } },
      }),
    );
    return { items };
  }
}
