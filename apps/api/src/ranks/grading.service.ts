import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Discipline, Prisma, PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { RanksService } from './ranks.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { DeclareRankDto, DowngradeActionDto, EditRankDateDto, GradingActionDto, MAX_STARTING_CLASSES, VerifyRankDto, VoidPromotionEventDto } from './dto/grading-action.dto';
import { RequestContext } from '../common/request-context';
import { GRADING_NOTIFICATIONS_QUEUE } from '../jobs/queue.constants';
import { GradingPromotedJobData, queueReadyCheck } from '../jobs/grading-notifications.types';
import { eligibilityOnLadder, startOfLocalDay, studentEligibility, studentTimeZone, thresholdsOf } from './grading-eligibility';
import { BoardActiveDto, BoardMoveDto, BoardThresholdsDto, BulkPromoteDto, LogClassDto } from './dto/grading-board.dto';
import { isMembershipLive } from '../memberships/memberships.service';
import { PermissionToggle } from './dto/grading-permission.dto';

/** How each toggle reads in an error message (Decision 181). */
const TOGGLE_LABELS: Record<PermissionToggle, string> = {
  canPromote: 'Promote',
  canDowngrade: 'Move down',
  canSignOffSkills: 'Sign off skills',
  canAdjustProgress: 'Adjust progress',
  canVerifyRanks: 'Verify self-declared ranks',
  canVoidHistory: 'Void history entries',
  canChangeBoardThresholds: 'Change board %',
};
import { DateTime } from 'luxon';
import { loadLadder } from './grading-attendance';
import { boardMove, dayNumber, gradingDateProblem, localDay, requirementFor, Rung, rungIndex } from './engine';

// Same shape PrismaAppService#withTenantContext hands its callback — see that
// method's own comment for why $transaction/etc are deliberately omitted.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// History entries that move a student to a different rung. ADJUSTMENT entries
// (board drags, rank-date corrections) do not.
const RANK_CHANGE_TYPES = ['PROMOTION', 'DOWNGRADE', 'STRIPE_AWARD', 'BULK_PROMOTION', 'BULK_STRIPE_AWARD', 'SELF_DECLARED', 'RANK_CORRECTION'] as const;


// Same pattern MembershipsService.getMembershipStatus() uses for its :id check.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A timestamp from Postgres JSON (to_jsonb of a timestamp without time zone,
 * which Prisma stores as UTC): "2026-10-10T07:00:00.123" → Date. */
function dbDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`);
}

/** StudentRank's DateTime fields, from the Prisma schema. */
const STUDENT_RANK_DATE_FIELDS = Prisma.dmmf.datamodel.models
  .find((m) => m.name === 'StudentRank')!
  .fields.filter((f) => f.type === 'DateTime')
  .map((f) => f.name);

/** A StudentRank row (with its skill sign-offs) from grading_board_rows(). */
function studentRankFromJson(json: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...json };
  for (const field of STUDENT_RANK_DATE_FIELDS) if (field in row) row[field] = dbDate(row[field]);
  return row as unknown as Prisma.StudentRankGetPayload<{ include: { skillStatuses: { select: { skillId: true; status: true } } } }>;
}

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
    @InjectQueue(GRADING_NOTIFICATIONS_QUEUE) private readonly gradingNotificationsQueue: Queue,
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
      // Each style's own board columns (Decisions 75, 136, 181).
      const styles = await tx.discipline.findMany({ where: { schoolId }, select: { id: true, boardGettingThere: true, boardReadyToGrade: true } });
      const items: Array<Record<string, unknown>> = [];
      for (const row of page.items as Array<Parameters<typeof studentEligibility>[1] & { id: string }>) {
        const style = styles.find((d) => d.id === row.disciplineId);
        items.push({ ...row, eligibility: await studentEligibility(tx, row, timeZone, undefined, style ? thresholdsOf(style) : undefined) });
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
        // Newest first by grading date, as the prototype (the cursor stays the id).
        (args) =>
          tx.promotionEvent.findMany({
            ...args,
            where: { studentId, schoolId, ...(includeVoided ? {} : { voidedAt: null }) },
            orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          }),
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
   * (Decision 168). Covers every grading write; each needs its own toggle of
   * that permission (Decision 181): promote (grade, stripe award, bulk),
   * downgrade, skill sign-off, adjust progress (board move, log a class, rank
   * date, Active switch), verify, void. Replaces the plain
   * assertStaffAtSchool() check, which admitted all staff to every grading
   * action and was flagged [UNRESOLVED] in this file. */
  async assertCanGrade(callerId: string, schoolId: string, disciplineId: string, studentId: string, toggle: PermissionToggle): Promise<void> {
    const authorize = await this.gradeAuthorizer(callerId, schoolId, disciplineId, toggle);
    await authorize(studentId);
  }

  /** assertCanGrade for many students (bulk promote): what concerns only the
   * caller — owner or not, staff grant, the permission and its toggle, their
   * branches — is read once; each student is then checked for branch and
   * enrollment (stress round, finding 2). Same rules, same messages. */
  private async gradeAuthorizer(
    callerId: string,
    schoolId: string,
    disciplineId: string,
    toggle: PermissionToggle,
  ): Promise<(studentId: string) => Promise<void>> {
    if (await this.isSchoolOwner(callerId, schoolId)) {
      return (studentId) => this.assertEnrolledStudent(studentId, schoolId);
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const permission = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.gradingPermission.findUnique({ where: { userId_disciplineId: { userId: callerId, disciplineId } } }),
    );
    if (!permission || permission.schoolId !== schoolId) {
      throw new ForbiddenException('You do not have grading permission for this style. The School owner grants it.');
    }
    // Decision 181: each action needs its own toggle.
    if (!permission[toggle]) {
      throw new ForbiddenException(`Your grading permission for this style doesn't include this: ${TOGGLE_LABELS[toggle]}. The School owner can turn it on.`);
    }
    const coverage = await this.branchCoverage(callerId, schoolId);
    return async (studentId) => {
      await this.assertBranchCoversStudent(coverage, schoolId, studentId);
      await this.assertEnrolledStudent(studentId, schoolId);
    };
  }

  /** Grading is for the School's own students (stress round, finding 8): an
   * active STUDENT grant here, read under the student's own context. Checked
   * after the caller's own rights, so it tells an outsider nothing. */
  private async assertEnrolledStudent(studentId: string, schoolId: string): Promise<void> {
    if (!UUID_PATTERN.test(studentId)) throw new BadRequestException('studentId must be a valid UUID');
    const grant = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } }),
    );
    if (!grant) throw new NotFoundException('This person isn\'t a student at this School.');
  }

  /** Reads: the owner sees every student; other staff see the students of
   * their own branches, with or without grading permission (Decision 168). */
  private async assertStaffCanSeeStudent(callerId: string, schoolId: string, studentId: string): Promise<void> {
    if (await this.isSchoolOwner(callerId, schoolId)) return;
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.assertBranchCoversStudent(await this.branchCoverage(callerId, schoolId), schoolId, studentId);
  }

  /** Decision 168 (with 139 and 148):
   * - A School with no branches is one branch: every staff member covers
   *   every student.
   * - In a School with branches, staff cover the students whose home branch
   *   is one of the branches they are assigned to (one staff RoleGrant per
   *   branch; a coach may hold several). A staff grant with no branch covers
   *   no students there, and a student with no home branch yet is the
   *   owner's alone until the owner assigns one. */
  /** Which branches a staff member covers at a School (Decisions 168, 169):
   * none needed when it has no branches; otherwise their staff grants'
   * branches. Under the caller's context, Branch RLS shows a staff member at
   * least their own branch, so any row means the School has branches. */
  private async branchCoverage(callerId: string, schoolId: string): Promise<{ hasBranches: boolean; branchIds: Set<string> }> {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const anyBranch = await tx.branch.findFirst({ where: { schoolId }, select: { id: true } });
      if (!anyBranch) return { hasBranches: false, branchIds: new Set<string>() };
      const grants = await tx.roleGrant.findMany({
        where: { userId: callerId, schoolId, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] }, revokedAt: null, branchId: { not: null } },
        select: { branchId: true },
      });
      return { hasBranches: true, branchIds: new Set(grants.map((g) => g.branchId as string)) };
    });
  }

  private async assertBranchCoversStudent(
    coverage: { hasBranches: boolean; branchIds: Set<string> },
    schoolId: string,
    studentId: string,
  ): Promise<void> {
    if (!coverage.hasBranches) return;
    if (!UUID_PATTERN.test(studentId)) throw new BadRequestException('studentId must be a valid UUID');
    const home = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.studentHomeBranch.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { branchId: true } }),
    );
    if (!home) {
      throw new ForbiddenException('This student has no home branch yet. Only the School owner can see or grade them until one is assigned.');
    }
    if (!coverage.branchIds.has(home.branchId)) {
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
   *   "Skipped N ranks in between"); default the next rung. Downgrade: down
   *   only, to any lower rung, with a reason, dated today; default the rung
   *   just below (Decision 185, as the prototype). Stripe award: the next
   *   stripe tier of the same belt.
   * - expectedCurrentRungId (Decision 185): when sent, refused with 409 if the
   *   student is no longer on that rung, so a second coach (or a bulk batch
   *   planned earlier) can't apply the same step twice or undo a change.
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
   * STRIPE_AWARD, notifies the Student, or a minor's guardians, through the
   * grading-notifications job — see notifyOfGradingAction's own comment for
   * why this is scoped to these three types only. Clears "ready to grade" and
   * checks the new rung (Decision 178).
   */
  private async changeRung(
    callerId: string,
    studentId: string,
    disciplineId: string,
    dto: GradingActionDto & { reason?: string },
    type: 'PROMOTION' | 'DOWNGRADE' | 'STRIPE_AWARD',
    // Bulk promote (Decision 130) records its own history type and note.
    bulk?: { eventType: 'BULK_PROMOTION' | 'BULK_STRIPE_AWARD'; systemNote: string },
    // Bulk promote checks the style, the School and the caller once for the
    // batch and loads the ladder once; each student is still authorized.
    batch?: { discipline: Discipline; ladder: Rung[]; authorize: (studentId: string) => Promise<void> },
  ) {
    const discipline =
      batch?.discipline ?? (await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } })));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    if (batch) {
      await batch.authorize(studentId);
    } else {
      await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId, type === 'DOWNGRADE' ? 'canDowngrade' : 'canPromote');
      await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);
    }

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
      const ladder = batch?.ladder ?? (await loadLadder(tx, disciplineId));
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
      if (dto.expectedCurrentRungId !== undefined && (from?.id ?? null) !== dto.expectedCurrentRungId) {
        throw new ConflictException('This student\'s rank has changed since you opened it. Reload and try again.');
      }
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
        // Default: the next rung up, or the rung just below (Decision 185).
        toIndex = fromIndex + (type === 'PROMOTION' ? 1 : -1);
        if (!ladder[toIndex]) {
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
        // "Ready to grade" is once per rank (Decision 178).
        readyNotifiedAt: null,
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
          type: bulk?.eventType ?? type,
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
          systemNote: bulk?.systemNote ?? (skipped > 0 ? `Skipped ${skipped} rank${skipped > 1 ? 's' : ''} in between.` : null),
          startingClasses: type === 'DOWNGRADE' ? null : startingTotal,
          startingClassesByType: startingByType ?? undefined,
        },
      });

      return { studentRank, promotionEvent, toRungName: to.name };
    });

    // Only "promoted" and "new stripe" reach the student (Decision 145); a
    // downgrade shows in their history, with no notification (Decision 185).
    if (type !== 'DOWNGRADE') {
      const isStripe = type === 'STRIPE_AWARD' || bulk?.eventType === 'BULK_STRIPE_AWARD';
      await this.notifyOfGradingAction({
        promotionEventId: result.promotionEvent.id,
        studentId,
        disciplineName: discipline.name,
        toRungName: result.toRungName,
        kind: isStripe ? 'STRIPE' : 'PROMOTED',
      });
    }
    await queueReadyCheck(this.gradingNotificationsQueue, studentId, disciplineId);

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
        if (!Number.isInteger(n) || n < 0 || n > MAX_STARTING_CLASSES) {
          throw new BadRequestException(`Each starting class number must be a whole number from 0 to ${MAX_STARTING_CLASSES}.`);
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

  /** Promotion-notification wiring: a PROMOTION/DOWNGRADE/STRIPE_AWARD only —
   * not SELF_DECLARED (the student's own action, no one "did" it to them) and
   * not RANK_CORRECTION/ADJUSTMENT (administrative corrections, not a "you
   * were graded" moment). The grading-notifications job sends it to the
   * student, or to a minor's guardians (Decision 145, item 2): GuardianLink
   * is readable only by the guardian here, so the job (ultm8_jobs) routes it. */
  private async notifyOfGradingAction(data: GradingPromotedJobData): Promise<void> {
    await this.gradingNotificationsQueue.add('promoted', data, {
      jobId: `grading-promoted-${data.promotionEventId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  /** After a grading action commits, check whether the student is now ready
   * for their next rung (Decisions 145, 178). */
  private async thenCheckReady<T>(studentId: string, disciplineId: string, action: Promise<T>): Promise<T> {
    const result = await action;
    await queueReadyCheck(this.gradingNotificationsQueue, studentId, disciplineId);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Bulk promote (roadmap Phase 3c; Decision 130)
  // ---------------------------------------------------------------------------

  /**
   * Promote up to 200 students one rung each, on one date (Decision 130,
   * prototype confirmBulkPromote). The same checks as a single grade, judged
   * per student, in one fast step:
   * - Nothing missing: promoted with no extra step.
   * - "Needs a look": required skills not signed off, or minimum days not yet
   *   served. Promoted only when the coach acknowledges them
   *   (acknowledgedStudentIds, one tick for the whole list); an unacknowledged
   *   flagged student refuses the whole request, so nobody is promoted past a
   *   check by accident. The acknowledgement is recorded on their history.
   * - Can't be promoted (skipped): no next rank, blocked by the style's
   *   "skills required" switch, or not a student this coach may grade.
   * One grading date must suit every student, or the request is refused
   * (prototype). `dryRun` returns the same three lists without changing
   * anything, for the confirm window. Each student is promoted in their own
   * transaction, so one student changed at the same time is skipped, not the
   * whole batch.
   */
  async bulkPromote(callerId: string, schoolId: string, dto: BulkPromoteDto) {
    if (!UUID_PATTERN.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: dto.disciplineId } }));
    if (!discipline || discipline.schoolId !== schoolId) {
      throw new NotFoundException('Discipline not found');
    }
    if (!(await this.isSchoolOwner(callerId, schoolId))) await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.assertSchoolAcceptsGradingWrites(callerId, schoolId);

    type Row = { studentId: string; fromRungId?: string | null; toRungId?: string; reasons: string[]; promotionEventId?: string };
    const ready: Array<Row & { toRungId: string; sameBelt: boolean; missingSkills: boolean }> = [];
    const needsAcknowledgement: Array<Row & { toRungId: string; sameBelt: boolean; missingSkills: boolean }> = [];
    const cannotPromote: Row[] = [];
    const dateProblems: string[] = [];

    // The caller, their permission and the ladder: once for the batch.
    let authorize: (studentId: string) => Promise<void>;
    try {
      authorize = await this.gradeAuthorizer(callerId, schoolId, dto.disciplineId, 'canPromote');
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
      authorize = () => Promise.reject(err);
    }
    const ladder = await this.prismaApp.withTenantContext(callerId, (tx) => loadLadder(tx, dto.disciplineId));
    const batch = { discipline, ladder, authorize };

    for (const studentId of dto.studentIds) {
      try {
        await authorize(studentId);
      } catch (err) {
        if (err instanceof ForbiddenException || err instanceof NotFoundException || err instanceof BadRequestException) {
          cannotPromote.push({ studentId, reasons: ['not a student you can grade in this style'] });
          continue;
        }
        throw err;
      }
      const plan = await this.prismaApp.withTenantContext(studentId, async (tx) => {
        const sr = await tx.studentRank.findUnique({
          where: { studentId_disciplineId: { studentId, disciplineId: dto.disciplineId } },
          include: { skillStatuses: { select: { skillId: true, status: true } } },
        });
        if (!sr) return { cannot: 'no rank in this style' };
        const fromIndex = sr.currentStripeId ? rungIndex(ladder, sr.currentStripeId) : -1;
        const next = fromIndex >= 0 ? ladder[fromIndex + 1] : undefined;
        if (!next) return { cannot: 'no next rank' };
        const timeZone = await studentTimeZone(tx, studentId, schoolId);
        const el = eligibilityOnLadder(ladder, sr, timeZone);
        if (!el.hasNext) return { cannot: 'no next rank' };
        const missing = el.timeOnly ? 0 : el.missingSkillIds.length;
        if (missing > 0 && discipline.skillsRequiredToGrade) return { cannot: 'required skills not signed off (this style requires them)' };
        const problem = dto.effectiveDate ? gradingDateProblem(dto.effectiveDate, localDay(new Date(), timeZone), localDay(sr.dateOfCurrentRank, timeZone)) : null;
        const reasons: string[] = [];
        if (missing > 0) reasons.push(`${missing} skill${missing > 1 ? 's' : ''} not signed off`);
        const short = el.requiredDays - el.elapsedDays;
        if (short > 0) reasons.push(`${short} day${short > 1 ? 's' : ''} short`);
        return { fromRungId: sr.currentStripeId, toRungId: next.id, sameBelt: next.rankId === sr.currentRankId, missingSkills: missing > 0, reasons, problem };
      });
      if ('cannot' in plan) {
        cannotPromote.push({ studentId, reasons: [plan.cannot as string] });
        continue;
      }
      if (plan.problem) dateProblems.push(`${studentId}: ${plan.problem}`);
      const row = { studentId, fromRungId: plan.fromRungId, toRungId: plan.toRungId, sameBelt: plan.sameBelt, missingSkills: plan.missingSkills, reasons: plan.reasons };
      (plan.reasons.length > 0 ? needsAcknowledgement : ready).push(row);
    }

    if (dateProblems.length > 0) {
      throw new BadRequestException(
        `The grading date doesn't suit every student — it can't be in the future or before a student's current rank date (Decision 128, item 8): ${dateProblems.join('; ')}.`,
      );
    }
    const strip = (r: Row & { sameBelt?: boolean; missingSkills?: boolean }): Row => ({
      studentId: r.studentId,
      fromRungId: r.fromRungId,
      toRungId: r.toRungId,
      reasons: r.reasons,
      ...(r.promotionEventId ? { promotionEventId: r.promotionEventId } : {}),
    });
    if (dto.dryRun) {
      return { ready: ready.map(strip), needsAcknowledgement: needsAcknowledgement.map(strip), cannotPromote };
    }
    const acknowledged = new Set(dto.acknowledgedStudentIds ?? []);
    const unacknowledged = needsAcknowledgement.filter((r) => !acknowledged.has(r.studentId));
    if (unacknowledged.length > 0) {
      throw new BadRequestException(
        `These students need a look: acknowledge them in acknowledgedStudentIds or remove them from the batch (Decision 130): ${unacknowledged
          .map((r) => `${r.studentId} (${r.reasons.join(', ')})`)
          .join('; ')}.`,
      );
    }

    const promoted: Row[] = [];
    for (const row of [...ready, ...needsAcknowledgement]) {
      const systemNote =
        row.reasons.length > 0 ? `Promoted in a batch; acknowledged: ${row.reasons.join(', ')} (Decision 130).` : 'Promoted in a batch.';
      try {
        const result = await this.changeRung(
          callerId,
          row.studentId,
          dto.disciplineId,
          {
            targetRungId: row.toRungId,
            // Refused if they moved since the plan (Decision 185): one rung each.
            expectedCurrentRungId: row.fromRungId ?? null,
            effectiveDate: dto.effectiveDate,
            note: dto.note,
            acknowledgeWithoutSkillSignoff: row.missingSkills,
          },
          'PROMOTION',
          { eventType: row.sameBelt ? 'BULK_STRIPE_AWARD' : 'BULK_PROMOTION', systemNote },
          batch,
        );
        promoted.push({ ...strip(row), promotionEventId: result.promotionEvent.id });
      } catch (err) {
        if (err instanceof ConflictException || err instanceof BadRequestException) {
          cannotPromote.push({ studentId: row.studentId, reasons: [err.message] });
          continue;
        }
        throw err;
      }
    }
    return { ready: promoted, needsAcknowledgement: [], cannotPromote };
  }

  // ---------------------------------------------------------------------------
  // Grading Board (roadmap Phase 3b; Decisions 128, 136, 152, 168, 174, 176)
  // ---------------------------------------------------------------------------

  /**
   * Every student with a next rank in one style, with their readiness from the
   * engine, highest progress first. The owner sees every student; other staff
   * see the students of their own branches, or every student when the School
   * has no branches (Decisions 168, 169). StudentRank and Membership stay
   * readable only by the owner or the student (Decision 88): the owner's
   * board is one read, and other staff's is read student by student under
   * each student's own context. Staff find *which* students are theirs through
   * two narrow read-only policies Gus approved for this board
   * (20261021000000_grading_board).
   */
  async getGradingBoard(callerId: string, schoolId: string, disciplineId: string, opts: { search?: string; activeOnly?: boolean }) {
    if (!UUID_PATTERN.test(schoolId) || !UUID_PATTERN.test(disciplineId ?? '')) {
      throw new BadRequestException('schoolId and disciplineId must be valid UUIDs');
    }
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline || discipline.schoolId !== schoolId) {
      throw new NotFoundException('Discipline not found');
    }
    const owner = await this.isSchoolOwner(callerId, schoolId);
    if (!owner) await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);

    const { ladder, schoolTimeZone } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      ladder: await loadLadder(tx, disciplineId),
      schoolTimeZone: (await tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }))?.timezone ?? null,
    }));

    type Row = {
      student: { id: string; firstName: string; surname: string };
      studentRank: Prisma.StudentRankGetPayload<{ include: { skillStatuses: { select: { skillId: true; status: true } } } }>;
      homeTimeZone: string | null;
      memberships: Array<{ status: string; expiryDate: Date | null; classesRemaining: number | null }>;
    };
    const rows: Row[] = [];
    const membershipSelect = { studentId: true, status: true, expiryDate: true, classesRemaining: true } as const;
    if (owner) {
      await this.prismaApp.withTenantContext(callerId, async (tx) => {
        const grants = await tx.roleGrant.findMany({
          where: { schoolId, role: 'STUDENT', revokedAt: null },
          distinct: ['userId'],
          select: { user: { select: { id: true, firstName: true, surname: true } } },
        });
        const ids = grants.map((g) => g.user.id);
        const [ranks, homes, memberships] = await Promise.all([
          tx.studentRank.findMany({ where: { schoolId, disciplineId, studentId: { in: ids } }, include: { skillStatuses: { select: { skillId: true, status: true } } } }),
          tx.studentHomeBranch.findMany({ where: { schoolId, studentId: { in: ids } }, select: { studentId: true, branch: { select: { timezone: true } } } }),
          tx.membership.findMany({ where: { schoolId, studentId: { in: ids } }, select: membershipSelect }),
        ]);
        // Keyed by student, not searched per student (stress round, finding 3).
        const rankOf = new Map(ranks.map((r) => [r.studentId, r]));
        const zoneOf = new Map(homes.map((h) => [h.studentId, h.branch.timezone]));
        const membershipsOf = new Map<string, typeof memberships>();
        for (const m of memberships) membershipsOf.set(m.studentId, [...(membershipsOf.get(m.studentId) ?? []), m]);
        for (const g of grants) {
          const sr = rankOf.get(g.user.id);
          if (!sr) continue;
          rows.push({ student: g.user, studentRank: sr, homeTimeZone: zoneOf.get(g.user.id) ?? null, memberships: membershipsOf.get(g.user.id) ?? [] });
        }
      });
    } else {
      // Who this staff member may see (Decisions 168, 169, 177): the students
      // whose home branch is one of theirs, or, in a School with no branches,
      // every enrolled student. One query through grading_board_rows()
      // (20261027000000), which applies that rule for the caller; it replaced
      // reading each student in their own transaction (stress round, finding 1).
      const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.$queryRaw<
          Array<{ studentId: string; firstName: string; surname: string; homeTimeZone: string | null; studentRank: Record<string, unknown>; memberships: Array<Record<string, unknown>> }>
        >`SELECT * FROM grading_board_rows(${schoolId}, ${disciplineId})`,
      );
      for (const r of found) {
        rows.push({
          student: { id: r.studentId, firstName: r.firstName, surname: r.surname },
          studentRank: studentRankFromJson(r.studentRank),
          homeTimeZone: r.homeTimeZone,
          memberships: r.memberships.map((m) => ({
            status: m.status as string,
            expiryDate: dbDate(m.expiryDate),
            classesRemaining: (m.classesRemaining as number | null) ?? null,
          })),
        });
      }
    }

    const needle = opts.search?.trim().toLowerCase();
    const now = new Date();
    let hiddenInactive = 0;
    const items: Array<{
      studentId: string;
      firstName: string;
      surname: string;
      studentRankId: string;
      currentRankId: string;
      currentStripeId: string | null;
      verificationStatus: string;
      active: boolean;
      activeSource: 'MANUAL' | 'MEMBERSHIP';
      hasActiveMembership: boolean;
      hardBlocked: boolean;
      eligibility: Extract<ReturnType<typeof eligibilityOnLadder>, { hasNext: true }>;
    }> = [];
    for (const row of rows) {
      const { student, studentRank: sr } = row;
      const hasActiveMembership = row.memberships.some((m) => isMembershipLive(m, now));
      const active = sr.boardActiveOverride ?? hasActiveMembership;
      // "N inactive hidden" counts every inactive student in the style, the
      // search aside, as the prototype (Gus's 7 Oct fix).
      if (opts.activeOnly && !active) {
        hiddenInactive++;
        continue;
      }
      if (needle && !`${student.firstName} ${student.surname}`.toLowerCase().includes(needle)) continue;
      const eligibility = eligibilityOnLadder(ladder, sr, row.homeTimeZone ?? schoolTimeZone ?? 'UTC', now, thresholdsOf(discipline));
      if (!eligibility.hasNext) continue; // nothing to progress toward: not on the board (prototype)
      items.push({
        studentId: student.id,
        firstName: student.firstName,
        surname: student.surname,
        studentRankId: sr.id,
        currentRankId: sr.currentRankId,
        currentStripeId: sr.currentStripeId,
        verificationStatus: sr.verificationStatus,
        active,
        activeSource: sr.boardActiveOverride === null ? 'MEMBERSHIP' : 'MANUAL',
        hasActiveMembership,
        hardBlocked: discipline.skillsRequiredToGrade && !eligibility.timeOnly && eligibility.missingSkillIds.length > 0,
        eligibility,
      });
    }
    items.sort(
      (a, b) =>
        b.eligibility.progressPercent - a.eligibility.progressPercent ||
        a.surname.localeCompare(b.surname) ||
        a.firstName.localeCompare(b.firstName),
    );
    return { items, hiddenInactive };
  }

  /** Shared start of the board writes: the same staff check and School gates as
   * every grading write, then the student's rank, ladder and time zone. */
  private async withBoardTarget<T>(
    callerId: string,
    studentId: string,
    disciplineId: string,
    fn: (
      tx: TenantTx,
      ctx: {
        discipline: { id: string; schoolId: string; classTypesOffered: string[]; boardGettingThere: number; boardReadyToGrade: number };
        studentRank: Prisma.StudentRankGetPayload<{ include: { skillStatuses: true } }>;
        ladder: Rung[];
        timeZone: string;
      },
    ) => Promise<T>,
  ): Promise<T> {
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId, 'canAdjustProgress');
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);
    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const studentRank = await tx.studentRank.findUnique({
        where: { studentId_disciplineId: { studentId, disciplineId } },
        include: { skillStatuses: true },
      });
      if (!studentRank) {
        throw new BadRequestException('This Student has no rank in this Discipline.');
      }
      const ladder = await loadLadder(tx, disciplineId);
      const timeZone = await studentTimeZone(tx, studentId, discipline.schoolId);
      return fn(tx, { discipline, studentRank, ladder, timeZone });
    });
  }

  private adjustmentEvent(
    tx: TenantTx,
    callerId: string,
    sr: { id: string; schoolId: string; studentId: string; currentRankId: string; currentStripeId: string | null },
    systemNote: string,
  ) {
    return tx.promotionEvent.create({
      data: {
        id: randomUUID(),
        studentRankId: sr.id,
        schoolId: sr.schoolId,
        studentId: sr.studentId,
        type: 'ADJUSTMENT',
        performedById: callerId,
        fromRankId: sr.currentRankId,
        toRankId: sr.currentRankId,
        fromStripeTierId: sr.currentStripeId,
        toStripeTierId: sr.currentStripeId,
        systemNote,
      },
    });
  }

  /** A style's Grading Board columns (Decisions 75, 136, 181): the owner, or
   * a coach with the "Change board %" toggle for this style. Not tied to a
   * student, so the branch rule doesn't apply. */
  async setBoardThresholds(callerId: string, disciplineId: string, dto: BoardThresholdsDto) {
    if (!UUID_PATTERN.test(disciplineId)) {
      throw new BadRequestException('disciplineId must be a valid UUID');
    }
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    if (!(await this.isSchoolOwner(callerId, discipline.schoolId))) {
      await this.tenantAuth.assertStaffAtSchool(callerId, discipline.schoolId);
      const permission = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.gradingPermission.findUnique({ where: { userId_disciplineId: { userId: callerId, disciplineId } } }),
      );
      if (!permission || permission.schoolId !== discipline.schoolId || !permission.canChangeBoardThresholds) {
        throw new ForbiddenException(`Your grading permission for this style doesn't include this: ${TOGGLE_LABELS.canChangeBoardThresholds}. The School owner can turn it on.`);
      }
    }
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);
    if (dto.gettingThere >= dto.readyToGrade) {
      throw new BadRequestException('"Getting There" must start below "Ready to Grade".');
    }
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.discipline.update({ where: { id: disciplineId }, data: { boardGettingThere: dto.gettingThere, boardReadyToGrade: dto.readyToGrade } }),
    );
  }

  /** Board drag (Decision 128, item 13; prototype dropOnBand): rewrites the
   * class count — on an "each type" rung every type to the column's % of its
   * own number (Decision 174) — or, on a time-only rung, the rank date, and
   * records an ADJUSTMENT entry. */
  async moveOnBoard(callerId: string, studentId: string, disciplineId: string, dto: BoardMoveDto) {
    return this.thenCheckReady(studentId, disciplineId, this.withBoardTarget(callerId, studentId, disciplineId, async (tx, { discipline, studentRank: sr, ladder, timeZone }) => {
      const thresholds = thresholdsOf(discipline);
      const current = eligibilityOnLadder(ladder, sr, timeZone, undefined, thresholds);
      if (current.hasNext && current.boardColumn === dto.column) {
        throw new BadRequestException('This student is already in that column.');
      }
      const move = boardMove(requirementFor(ladder, sr.currentStripeId ?? ''), dto.column, thresholds);
      if (move.kind === 'NOT_MOVABLE') {
        throw new BadRequestException('This student can\'t be moved: there is no next rank, or nothing required to split into columns.');
      }
      const label = { JUST_STARTING: 'Just Starting', GETTING_THERE: 'Getting There', READY_TO_GRADE: 'Ready to Grade' }[dto.column];
      let what: string;
      let data: Prisma.StudentRankUpdateManyMutationInput;
      if (move.kind === 'DAYS') {
        const newDay = DateTime.now().setZone(timeZone).minus({ days: move.daysInRank }).toISODate() as string;
        what = `time-in-rank start date changed from ${localDay(sr.dateOfCurrentRank, timeZone)} to ${newDay}`;
        data = { dateOfCurrentRank: startOfLocalDay(newDay, timeZone) };
      } else {
        const typeText = move.byType ? ` (${Object.entries(move.byType).map(([t, n]) => `${t} ${n}`).join(', ')})` : '';
        what = `classes attended changed from ${sr.classesAttendedTowardCheckpoint} to ${move.total}${typeText}`;
        data = { classesAttendedTowardCheckpoint: move.total, ...(move.byType ? { classesAttendedByType: move.byType } : {}) };
      }
      const updated = await tx.studentRank.updateMany({
        where: { id: sr.id, currentStripeId: sr.currentStripeId, dateOfCurrentRank: sr.dateOfCurrentRank, classesAttendedTowardCheckpoint: sr.classesAttendedTowardCheckpoint },
        data,
      });
      if (updated.count === 0) {
        throw new ConflictException('This Student\'s progress was changed at the same time — please retry.');
      }
      const promotionEvent = await this.adjustmentEvent(tx, callerId, sr, `Progress adjusted by hand on the Grading Board: ${what} (moved to "${label}").`);
      return { studentRank: await tx.studentRank.findUniqueOrThrow({ where: { id: sr.id } }), promotionEvent };
    }));
  }

  /** "Log a class" (Decision 128 item 6, Decision 176): staff add one class by
   * hand, with a class type from the next rank's ticked types. It always
   * counts — the weekly cap is for attendance, not a deliberate entry — and it
   * is written to the history. */
  async logClass(callerId: string, studentId: string, disciplineId: string, dto: LogClassDto) {
    return this.thenCheckReady(studentId, disciplineId, this.withBoardTarget(callerId, studentId, disciplineId, async (tx, { discipline, studentRank: sr, ladder }) => {
      const req = requirementFor(ladder, sr.currentStripeId ?? '');
      if (req.kind !== 'NEXT') throw new BadRequestException('This student has no next rank to count classes toward.');
      if (req.timeOnly) throw new BadRequestException('The current rank counts time only, so classes are not counted (Decision 128, item 3).');
      const classType = dto.classType ?? null;
      const ticked = req.countRules.eligibleClassTypes;
      if (ticked.length > 0 && (classType === null || !ticked.includes(classType))) {
        throw new BadRequestException(`Pick the class type: one of ${ticked.join(', ')} (Decision 176).`);
      }
      if (ticked.length === 0 && classType !== null && !discipline.classTypesOffered.includes(classType)) {
        throw new BadRequestException(`"${classType}" is not one of this style's class types.`);
      }
      const byType = { ...(sr.classesAttendedByType as Record<string, number>) };
      if (classType !== null) byType[classType] = (byType[classType] ?? 0) + 1;
      const updated = await tx.studentRank.updateMany({
        where: { id: sr.id, currentStripeId: sr.currentStripeId, classesAttendedTowardCheckpoint: sr.classesAttendedTowardCheckpoint },
        data: { classesAttendedTowardCheckpoint: sr.classesAttendedTowardCheckpoint + 1, classesAttendedByType: byType },
      });
      if (updated.count === 0) {
        throw new ConflictException('This Student\'s progress was changed at the same time — please retry.');
      }
      const promotionEvent = await this.adjustmentEvent(
        tx,
        callerId,
        sr,
        `Class logged by hand: ${classType ?? 'no class type'} (classes ${sr.classesAttendedTowardCheckpoint} → ${sr.classesAttendedTowardCheckpoint + 1}).`,
      );
      return { studentRank: await tx.studentRank.findUniqueOrThrow({ where: { id: sr.id } }), promotionEvent };
    }));
  }

  /** The manual Active/Inactive switch for this style (Decisions 152, 176);
   * null goes back to following membership. */
  async setBoardActive(callerId: string, studentId: string, disciplineId: string, dto: BoardActiveDto) {
    return this.withBoardTarget(callerId, studentId, disciplineId, async (tx, { studentRank: sr }) =>
      tx.studentRank.update({ where: { id: sr.id }, data: { boardActiveOverride: dto.active } }),
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
    await this.assertCanGrade(callerId, skill.schoolId, skill.disciplineId, studentId, 'canSignOffSkills');
    await this.assertSchoolAcceptsGradingWrites(callerId, skill.schoolId);

    return this.thenCheckReady(studentId, skill.disciplineId, this.prismaApp.withTenantContext(studentId, async (tx) => {
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
    }));
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
    await this.assertCanGrade(callerId, schoolId, found.studentRank.disciplineId, studentId, 'canVoidHistory');
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
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId, 'canAdjustProgress');
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    if (dayNumber(dto.date) === null) {
      throw new BadRequestException('date must be a real calendar date, as YYYY-MM-DD.');
    }

    return this.thenCheckReady(studentId, disciplineId, this.prismaApp.withTenantContext(studentId, async (tx) => {
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
    }));
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

    return this.thenCheckReady(studentId, disciplineId, this.prismaApp.withTenantContext(studentId, async (tx) => {
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
    }));
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
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId, 'canVerifyRanks');
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    return this.thenCheckReady(studentId, disciplineId, this.prismaApp.withTenantContext(studentId, async (tx) => {
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
          // A corrected rung is a new rank: "ready to grade" may notify again (Decision 178).
          ...(corrected ? { readyNotifiedAt: null } : {}),
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
    }));
  }

  /** Belts waiting to be verified at a School, for the notice shown at login
   * (Decisions 137 item 4, 189). The owner sees every enrolled student's; a
   * coach or Branch Staff member sees those in the styles where they may
   * verify (Decision 181's "Verify ranks"), for the students they cover
   * (Decision 168), through the Grading Board's read path; anyone else at
   * the School gets an empty list. Oldest first. */
  async findPendingVerifications(callerId: string, schoolId: string) {
    if (!UUID_PATTERN.test(schoolId)) {
      throw new BadRequestException('schoolId must be a valid UUID');
    }
    type Item = {
      studentRankId: string; studentId: string; firstName: string; surname: string; disciplineId: string; disciplineName: string;
      currentRankId: string; currentStripeId: string | null; verificationStatus: 'UNVERIFIED'; declaredAt: Date;
    };
    const items: Item[] = [];
    const push = (student: { id: string; firstName: string; surname: string }, discipline: { id: string; name: string }, sr: { id: string; currentRankId: string; currentStripeId: string | null; createdAt: Date }) =>
      items.push({
        studentRankId: sr.id, studentId: student.id, firstName: student.firstName, surname: student.surname,
        disciplineId: discipline.id, disciplineName: discipline.name,
        currentRankId: sr.currentRankId, currentStripeId: sr.currentStripeId, verificationStatus: 'UNVERIFIED', declaredAt: sr.createdAt,
      });

    if (await this.isSchoolOwner(callerId, schoolId)) {
      await this.prismaApp.withTenantContext(callerId, async (tx) => {
        const grants = await tx.roleGrant.findMany({
          where: { schoolId, role: 'STUDENT', revokedAt: null },
          distinct: ['userId'],
          select: { user: { select: { id: true, firstName: true, surname: true } } },
        });
        const studentOf = new Map(grants.map((g) => [g.user.id, g.user]));
        const ranks = await tx.studentRank.findMany({
          where: { schoolId, verificationStatus: 'UNVERIFIED', studentId: { in: [...studentOf.keys()] } },
          include: { discipline: { select: { id: true, name: true } } },
        });
        for (const sr of ranks) push(studentOf.get(sr.studentId)!, sr.discipline, sr);
      });
    } else {
      await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
      const permissions = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.gradingPermission.findMany({
          where: { userId: callerId, schoolId, canVerifyRanks: true },
          select: { discipline: { select: { id: true, name: true } } },
        }),
      );
      for (const { discipline } of permissions) {
        const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
          tx.$queryRaw<Array<{ studentId: string; firstName: string; surname: string; studentRank: Record<string, unknown> }>>`SELECT * FROM grading_board_rows(${schoolId}, ${discipline.id})`,
        );
        for (const r of found) {
          const sr = studentRankFromJson(r.studentRank);
          if (sr.verificationStatus === 'UNVERIFIED') push({ id: r.studentId, firstName: r.firstName, surname: r.surname }, discipline, sr);
        }
      }
    }
    items.sort((a, b) => a.declaredAt.getTime() - b.declaredAt.getTime() || a.surname.localeCompare(b.surname));
    return { items };
  }
}
