import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { GradingActionDto } from './dto/grading-action.dto';

// Same shape PrismaAppService#withTenantContext hands its callback — see that
// method's own comment for why $transaction/etc are deliberately omitted.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

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

  async findRankHistoryForStudent(callerId: string, studentId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    await this.assertCallerCanReadStudent(callerId, studentId, schoolId);
    return this.prismaApp.withTenantContext(studentId, (tx) =>
      cursorPaginate((args) => tx.promotionEvent.findMany({ ...args, where: { studentId, schoolId } }), cursor, limit),
    );
  }

  /** Staff (Owner/Manager/Branch Staff/Instructor) OR the Student themselves.
   * `schoolId` is a required parameter for the same reason GET /students/{id}/
   * membership-status needed one in Phase 9 — a Student's StudentRank rows are
   * School-scoped, and without it this can't know which School's data to read. */
  private async assertCallerCanReadStudent(callerId: string, studentId: string, schoolId: string): Promise<void> {
    if (callerId === studentId) return;
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
  }

  // ---------------------------------------------------------------------------
  // Grading actions — Instructor/Staff-initiated only (Spec 55 §5: "grading is
  // always coach-initiated, never automatic"). Reuses assertStaffAtSchool — a
  // Student may never grade themselves.
  //
  // [UNRESOLVED, flagged on review, not yet confirmed] assertStaffAtSchool
  // admits SCHOOL_OWNER_MANAGER, BRANCH_STAFF, and INSTRUCTOR alike (see its
  // own doc comment in tenant-authorization.service.ts) — but that method's
  // stated justification was written for a READ-only computed signal (GET
  // /students/{id}/membership-status, Phase 9), not a mutating grading action.
  // Spec 55 §5's "coach-initiated" language may or may not have meant to admit
  // generic BRANCH_STAFF (front-desk/admin staff, not necessarily a coach) to
  // promote/downgrade/stripe-award a Student. Reused as-is here rather than
  // narrowed, since narrowing it would be an equally unconfirmed guess in the
  // other direction — surfaced for product-owner confirmation, not resolved.
  // ---------------------------------------------------------------------------

  async promote(callerId: string, studentId: string, disciplineId: string, dto: GradingActionDto) {
    return this.gradeRankChange(callerId, studentId, disciplineId, dto, 'PROMOTION', 1);
  }

  async downgrade(callerId: string, studentId: string, disciplineId: string, dto: GradingActionDto) {
    return this.gradeRankChange(callerId, studentId, disciplineId, dto, 'DOWNGRADE', -1);
  }

  private async gradeRankChange(
    callerId: string,
    studentId: string,
    disciplineId: string,
    dto: GradingActionDto,
    type: 'PROMOTION' | 'DOWNGRADE',
    direction: 1 | -1,
  ) {
    const discipline = await this.prismaApp.withTenantContext(callerId, (tx) => tx.discipline.findUnique({ where: { id: disciplineId } }));
    if (!discipline) {
      throw new NotFoundException('Discipline not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, discipline.schoolId);

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
    await this.tenantAuth.assertStaffAtSchool(callerId, discipline.schoolId);

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
      const updateResult = await tx.studentRank.updateMany({
        where: { id: existing.id, currentRankId: existing.currentRankId, currentStripeId: existing.currentStripeId },
        data: { currentStripeId: nextTier.id, classesAttendedTowardCheckpoint: 0 },
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
    await this.tenantAuth.assertStaffAtSchool(callerId, skill.schoolId);

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
      const next = this.nextSkillStatus(existing?.status ?? 'NOT_STARTED');

      if (existing) {
        return tx.studentRankSkillStatus.update({ where: { id: existing.id }, data: { status: next } });
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

  private nextSkillStatus(current: string): 'NOT_STARTED' | 'LEARNING' | 'SIGNED_OFF' {
    if (current === 'NOT_STARTED') return 'LEARNING';
    if (current === 'LEARNING') return 'SIGNED_OFF';
    return 'NOT_STARTED';
  }
}
