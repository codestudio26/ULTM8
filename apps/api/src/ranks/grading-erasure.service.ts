import { Injectable, Logger } from '@nestjs/common';
import { PrismaGradingErasureService } from '../common/prisma/prisma-grading-erasure.service';

/**
 * Decisions 134/141 — the grading-specific slice of account deletion
 * (Spec 55 Decision 44), built as groundwork only: no endpoint and no
 * scheduler call this today. The full account-deletion mechanism doesn't
 * exist yet (there is no DELETE /users/me anywhere in this codebase), and
 * Decision 245's own text says its broader erasure design "doesn't
 * authorize building it yet" pending legal review. This class exists so a
 * future real account-deletion job has something correct to call for the
 * grading piece, instead of reasoning it out from scratch under time
 * pressure once that job finally gets built.
 *
 * Decision 141 (a deleted Instructor shows "Former instructor" on other
 * students' history) needs NO code here — it's already fully built and
 * tested via the FK itself: PromotionEvent.performedById/voidedById/
 * noteEditedById, SkillSignOffLog.changedById, and
 * PromotionEventNoteLog.changedById are all `onDelete: SetNull`, and the
 * portal already renders a null performedById as "Former instructor"
 * (StudentGradingPage.tsx). Deleting an Instructor's own User row already
 * does the right thing today, mechanically, with zero new code.
 *
 * Decision 134 (a deleted Student's own grading data is deleted with the
 * account) is what this service actually does: StudentRank.studentId -> User
 * has no onDelete (defaults to RESTRICT), so a Student's User row can't be
 * deleted while any StudentRank exists. This method clears that path.
 *
 * Runs as its own dedicated `ultm8_grading_erasure` Postgres role, not the
 * shared `ultm8_jobs` — see PrismaGradingErasureService's own header comment
 * for why: ultm8_jobs is one role shared by every background job, so
 * granting it DELETE here would also grant every OTHER job running as
 * ultm8_jobs that same ability, which is exactly what broke an existing
 * security test (Decision 178.5) on this feature's first draft.
 */
@Injectable()
export class GradingErasureService {
  private readonly logger = new Logger(GradingErasureService.name);

  constructor(private readonly prismaErasure: PrismaGradingErasureService) {}

  /**
   * Hard-deletes every StudentRank (and, by cascade, SkillSignOffLog) row for
   * this Student, across every School/discipline — the grading-specific
   * precondition a future account-deletion job needs before it can delete
   * the Student's own User row.
   *
   * Deletion order matters: StudentRankSkillStatus and PromotionEvent both
   * reference StudentRank with no ON DELETE action, so they're deleted first,
   * explicitly, in application code — not left to a DB cascade that doesn't
   * exist for them. PromotionEventNoteLog (-> PromotionEvent, Decision 192)
   * and SkillSignOffLog (-> StudentRank, Decision 156) both DO cascade at the
   * DB level, so deleting their parents here is enough; no separate call for
   * either is needed (confirmed empirically — a Postgres ON DELETE CASCADE
   * trigger runs independently of the deleting role's own grants/RLS on the
   * child table, the same behavior this codebase's own
   * EntityOffboardingPurgeProcessor already documents and relies on).
   *
   * Idempotent — a Student with no grading data at all is a no-op, not an
   * error, since the caller (the eventual account-deletion job) shouldn't
   * need to check first.
   */
  async eraseGradingDataForDeletedAccount(studentId: string): Promise<void> {
    const studentRanks = await this.prismaErasure.studentRank.findMany({
      where: { studentId },
      select: { id: true },
    });
    if (studentRanks.length === 0) {
      this.logger.log(`eraseGradingDataForDeletedAccount: Student ${studentId} has no grading data.`);
      return;
    }
    const studentRankIds = studentRanks.map((r) => r.id);

    await this.prismaErasure.studentRankSkillStatus.deleteMany({ where: { studentRankId: { in: studentRankIds } } });
    await this.prismaErasure.promotionEvent.deleteMany({ where: { studentRankId: { in: studentRankIds } } });
    await this.prismaErasure.studentRank.deleteMany({ where: { id: { in: studentRankIds } } });

    this.logger.log(
      `eraseGradingDataForDeletedAccount: Student ${studentId} — deleted ${studentRankIds.length} StudentRank row(s) and their history (Decision 134).`,
    );
  }
}
