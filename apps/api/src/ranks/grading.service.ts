import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { RanksService } from './ranks.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { DeclareRankDto, DowngradeActionDto, EditRankDateDto, GradingActionDto, VerifyRankDto, VoidPromotionEventDto } from './dto/grading-action.dto';
import { RequestContext } from '../common/request-context';

// Same shape PrismaAppService#withTenantContext hands its callback — see that
// method's own comment for why $transaction/etc are deliberately omitted.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

// History entries that move a student to a different rung. ADJUSTMENT entries
// (board drags, rank-date corrections) do not.
const RANK_CHANGE_TYPES = ['PROMOTION', 'DOWNGRADE', 'STRIPE_AWARD', 'BULK_PROMOTION', 'BULK_STRIPE_AWARD', 'SELF_DECLARED', 'RANK_CORRECTION'] as const;

/** The UTC calendar day of a date, as YYYY-MM-DD. Grading dates are whole days
 * (the prototype's dayNumber()). */
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

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

  /** Currently identical to findRanksForStudent — see StudentRank's own Prisma
   * model comment for why (Decision 75's readiness-bucket/progress-% formula is
   * genuinely undesigned; this returns the same raw fields pending that). Kept as
   * a separate method/route rather than aliased, since Spec 55 names it as its
   * own confirmed endpoint and a future phase will make the two genuinely
   * diverge once Decision 75 resolves. */
  async findEligibilityForStudent(callerId: string, studentId: string, schoolId: string): Promise<CursorPage<{ id: string }>> {
    return this.findRanksForStudent(callerId, studentId, schoolId);
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
    return this.gradeRankChange(callerId, studentId, disciplineId, dto, 'PROMOTION', 1);
  }

  async downgrade(callerId: string, studentId: string, disciplineId: string, dto: DowngradeActionDto) {
    return this.gradeRankChange(callerId, studentId, disciplineId, dto, 'DOWNGRADE', -1);
  }

  private async gradeRankChange(
    callerId: string,
    studentId: string,
    disciplineId: string,
    dto: GradingActionDto & { reason?: string },
    type: 'PROMOTION' | 'DOWNGRADE',
    direction: 1 | -1,
  ) {
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const existing = await tx.studentRank.findUnique({
        where: { studentId_disciplineId: { studentId, disciplineId } },
        include: { skillStatuses: true },
      });

      let targetRank;
      let fromRankId: string | null = null;
      let fromStripeTierId: string | null = null;

      if (!existing) {
        // First-ever grading action for this Student/Discipline pair. A
        // PROMOTION creates the StudentRank at the Discipline's first-order
        // Rank — Spec 55 doesn't explicitly describe how a Student's very
        // first StudentRank row comes into being; this is the most literal
        // reading given Ranks are a strict ordered ladder with no other
        // confirmed entry point. A DOWNGRADE with no existing StudentRank has
        // nothing to downgrade FROM — reject.
        if (type === 'DOWNGRADE') {
          throw new BadRequestException('This Student has no existing rank in this Discipline to downgrade from.');
        }
        targetRank = await tx.rank.findFirst({ where: { disciplineId }, orderBy: { order: 'asc' } });
        if (!targetRank) {
          throw new BadRequestException('This Discipline has no Ranks configured yet.');
        }
      } else {
        const currentRank = await tx.rank.findUniqueOrThrow({ where: { id: existing.currentRankId } });
        fromRankId = currentRank.id;
        fromStripeTierId = existing.currentStripeId;

        await this.assertSkillsSignedOffOrAcknowledged(tx, currentRank.id, existing.skillStatuses, dto.acknowledgeWithoutSkillSignoff ?? false);

        targetRank = await tx.rank.findFirst({ where: { disciplineId, order: currentRank.order + direction } });
        if (!targetRank) {
          throw new BadRequestException(
            type === 'PROMOTION' ? 'This Student is already at the highest Rank in this Discipline.' : 'This Student is already at the lowest Rank in this Discipline.',
          );
        }
      }

      const targetFirstStripe = await tx.rankStripeTier.findFirst({ where: { rankId: targetRank.id }, orderBy: { order: 'asc' } });

      let studentRank;
      if (existing) {
        // FOUND ON REVIEW: a plain tx.studentRank.update({where: {id}, ...})
        // here is a real TOCTOU race — two concurrent grading calls for the
        // same Student both read the same `existing` pre-image, both compute
        // the same targetRank, and the second UPDATE would silently overwrite
        // with its own stale precomputed data (no WHERE clause tied to what it
        // actually read), corrupting the audit trail with two PromotionEvent
        // rows for what the data shows as only one real transition. Fixed with
        // the same optimistic-concurrency shape Phase 9 already established
        // for Transaction status flips (updateMany + affected-row-count
        // check, not a bare update by id alone) — a losing concurrent call
        // gets a clean 409 to retry, not a silent corruption.
        const updateResult = await tx.studentRank.updateMany({
          where: { id: existing.id, currentRankId: existing.currentRankId, currentStripeId: existing.currentStripeId },
          data: {
            currentRankId: targetRank.id,
            currentStripeId: targetFirstStripe?.id ?? null,
            dateOfCurrentRank: new Date(),
            classesAttendedTowardCheckpoint: 0,
          },
        });
        if (updateResult.count === 0) {
          throw new ConflictException('This Student\'s rank was changed by a concurrent grading action — please retry.');
        }
        studentRank = await tx.studentRank.findUniqueOrThrow({ where: { id: existing.id } });
      } else {
        studentRank = await tx.studentRank.create({
          data: {
            id: randomUUID(),
            studentId,
            disciplineId,
            schoolId: discipline.schoolId,
            currentRankId: targetRank.id,
            currentStripeId: targetFirstStripe?.id ?? null,
          },
        });
      }

      // Checkpoint reset — skill sign-off status is scoped to the current
      // checkpoint only (§5); a Promotion/Downgrade moves to a new one.
      await tx.studentRankSkillStatus.deleteMany({ where: { studentRankId: studentRank.id } });

      const promotionEvent = await tx.promotionEvent.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: discipline.schoolId,
          studentId,
          type,
          performedById: callerId,
          fromRankId,
          toRankId: targetRank.id,
          fromStripeTierId,
          toStripeTierId: targetFirstStripe?.id ?? null,
          acknowledgedWithoutSkillSignoff: dto.acknowledgeWithoutSkillSignoff ?? false,
          // Required on a downgrade by DowngradeActionDto (Decision 128, item 11).
          reason: type === 'DOWNGRADE' ? dto.reason : null,
          note: dto.note ?? null,
        },
      });

      return { studentRank, promotionEvent };
    });
  }

  /** Spec 55 §5 (quoted): "unavailable once the Student is at a belt's highest
   * configured stripe tier" — a distinct, coach-initiated action from promote,
   * never system-triggered. */
  async stripeAward(callerId: string, studentId: string, disciplineId: string, dto: GradingActionDto) {
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.assertCanGrade(callerId, discipline.schoolId, disciplineId, studentId);
    await this.assertSchoolAcceptsGradingWrites(callerId, discipline.schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const existing = await tx.studentRank.findUnique({
        where: { studentId_disciplineId: { studentId, disciplineId } },
        include: { skillStatuses: true },
      });
      if (!existing) {
        throw new BadRequestException('This Student has no existing rank in this Discipline to award a stripe within.');
      }
      if (!existing.currentStripeId) {
        throw new BadRequestException('This Student\'s current Rank has no configured stripe tiers.');
      }

      await this.assertSkillsSignedOffOrAcknowledged(tx, existing.currentRankId, existing.skillStatuses, dto.acknowledgeWithoutSkillSignoff ?? false);

      const currentTier = await tx.rankStripeTier.findUniqueOrThrow({ where: { id: existing.currentStripeId } });
      const nextTier = await tx.rankStripeTier.findFirst({ where: { rankId: existing.currentRankId, order: currentTier.order + 1 } });
      if (!nextTier) {
        throw new BadRequestException('This Student is already at the highest configured stripe tier for this Rank.');
      }

      // Same TOCTOU-race fix as gradeRankChange — see that method's own
      // comment. updateMany + affected-row-count check instead of a bare
      // update-by-id, so a losing concurrent call gets a clean 409 instead of
      // silently clobbering another grading action's result.
      //
      // Every stripe is its own rung (Decision 126), so a stripe award restarts
      // the time-in-rank clock like any other rank change (Decision 167; the
      // prototype's applyRankChange sets `since` for every change).
      const updateResult = await tx.studentRank.updateMany({
        where: { id: existing.id, currentRankId: existing.currentRankId, currentStripeId: existing.currentStripeId },
        data: { currentStripeId: nextTier.id, classesAttendedTowardCheckpoint: 0, dateOfCurrentRank: new Date() },
      });
      if (updateResult.count === 0) {
        throw new ConflictException('This Student\'s rank was changed by a concurrent grading action — please retry.');
      }
      const studentRank = await tx.studentRank.findUniqueOrThrow({ where: { id: existing.id } });
      await tx.studentRankSkillStatus.deleteMany({ where: { studentRankId: studentRank.id } });

      const promotionEvent = await tx.promotionEvent.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: discipline.schoolId,
          studentId,
          type: 'STRIPE_AWARD',
          performedById: callerId,
          fromRankId: existing.currentRankId,
          toRankId: existing.currentRankId,
          fromStripeTierId: currentTier.id,
          toStripeTierId: nextTier.id,
          acknowledgedWithoutSkillSignoff: dto.acknowledgeWithoutSkillSignoff ?? false,
          note: dto.note ?? null,
        },
      });

      return { studentRank, promotionEvent };
    });
  }

  /** Spec 55 §5 (quoted): "grading is permitted even when a required skill isn't
   * yet signed off, but only behind an explicit, always-recorded written
   * acknowledgement flag." Checks the CURRENT checkpoint's required Skills (the
   * ones gating the grading action being attempted) — not the target
   * checkpoint's, which the Student hasn't reached yet.
   *
   * FOUND ON REVIEW: the original version of this check looked at whatever
   * StudentRankSkillStatus rows happened to already exist, rather than the
   * Rank's actual RankRequiredSkill set. Those rows are populated lazily —
   * only when someone calls cycleSkillSignOff — so a required Skill nobody
   * has ever touched had NO row at all, `.some()` found nothing unsigned, and
   * the acknowledgment gate was silently bypassed. Fixed to query the real
   * required-Skill set for `currentRankId` and treat a missing status row as
   * unsigned (NOT_STARTED), which is what it actually means. */
  private async assertSkillsSignedOffOrAcknowledged(
    tx: TenantTx,
    currentRankId: string,
    skillStatuses: Array<{ skillId: string; status: string }>,
    acknowledged: boolean,
  ): Promise<void> {
    const requiredSkills = await tx.rankRequiredSkill.findMany({ where: { rankId: currentRankId }, select: { skillId: true } });
    if (requiredSkills.length === 0) return; // nothing required at this checkpoint — nothing to acknowledge

    const statusBySkillId = new Map(skillStatuses.map((s) => [s.skillId, s.status]));
    const hasUnsignedRequired = requiredSkills.some((rs) => statusBySkillId.get(rs.skillId) !== 'SIGNED_OFF');
    if (hasUnsignedRequired && !acknowledged) {
      throw new BadRequestException(
        'This Student has required Skills not yet Signed Off at their current checkpoint. Set acknowledgeWithoutSkillSignoff=true to grade anyway (always recorded).',
      );
    }
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

      // FOUND ON REVIEW: the original version only checked the Skill belongs
      // to the same Discipline as the Student's StudentRank, never that it's
      // actually required at the Student's CURRENT Rank — letting sign-off
      // status be cycled for irrelevant Skills, which then fed back into
      // assertSkillsSignedOffOrAcknowledged's own (now-fixed) required-Skill
      // check as noise. A Skill not required at the current checkpoint has
      // nothing to sign off yet.
      const isRequiredAtCurrentRank = await tx.rankRequiredSkill.findUnique({
        where: { rankId_skillId: { rankId: studentRank.currentRankId, skillId } },
      });
      if (!isRequiredAtCurrentRank) {
        throw new BadRequestException('This Skill is not a required Skill at this Student\'s current Rank checkpoint.');
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

    const newDate = new Date(`${dto.date}T00:00:00.000Z`);
    if (Number.isNaN(newDate.getTime()) || dayOf(newDate) !== dto.date) {
      throw new BadRequestException('date must be a real calendar date, as YYYY-MM-DD.');
    }
    if (dto.date > dayOf(new Date())) {
      throw new BadRequestException('The rank date can\'t be in the future.');
    }

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
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
