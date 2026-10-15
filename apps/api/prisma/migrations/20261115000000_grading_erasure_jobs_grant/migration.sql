-- Grading-data erasure on account deletion (Decisions 134, 141), groundwork
-- only. No endpoint or scheduled job calls this yet — the full account-
-- deletion mechanism (Spec 55 Decision 44) isn't built, and Decision 245
-- explicitly says its own erasure design "doesn't authorize building it yet"
-- pending legal review. This grant exists so GradingErasureService can run
-- once a real caller (a future account-deletion job) exists.
--
-- A DEDICATED role, not a widened ultm8_jobs — same precedent
-- ultm8_discovery/ultm8_platform_admin already established (see Decision 94),
-- and confirmed necessary here, not just by convention: a first draft of this
-- migration granted DELETE on these three tables to the existing, SHARED
-- ultm8_jobs role instead. That broke a real, existing security invariant —
-- grading-ready-notification.e2e-spec.ts's own "the jobs role may only mark a
-- student as notified, nothing else in grading (Decision 178.5)" test — since
-- ultm8_jobs is ONE role shared by every background job, not one per job;
-- widening what it can do for this not-yet-built feature would have also
-- widened it for the already-shipped grading-notifications sweep, exactly the
-- kind of blast radius a dedicated role avoids by construction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_grading_erasure') THEN
    CREATE ROLE ultm8_grading_erasure LOGIN PASSWORD 'changeme';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ultm8_grading_erasure;

-- StudentRank/StudentRankSkillStatus/PromotionEvent's own pre-existing
-- "_school_staff_or_self" policies (20260914000000_ranks_module) were written
-- with no explicit `TO ultm8_app` — Postgres's default when CREATE POLICY
-- omits `TO` is PUBLIC, so this new role is ALSO subject to them, the same
-- "FOUND ON CI" wrinkle ultm8_discovery's own migration already hit and
-- documented. Evaluating that unrelated policy's inline
-- `EXISTS (SELECT 1 FROM "RoleGrant" ...)` needs SELECT on the exact columns
-- its WHERE clause references, even though it will simply be false for this
-- role's own DELETE (confirmed empirically before relying on it) — not
-- because GradingErasureService itself ever reads RoleGrant.
GRANT SELECT ("schoolId", "role", "userId", "revokedAt") ON "RoleGrant" TO ultm8_grading_erasure;

-- Deletion order matters: StudentRankSkillStatus and PromotionEvent both
-- reference StudentRank with no ON DELETE action (default RESTRICT), so they
-- must be deleted before the StudentRank row itself. PromotionEventNoteLog
-- (-> PromotionEvent) and SkillSignOffLog (-> StudentRank) both already
-- cascade at the DB level (Decisions 192, 156) — confirmed empirically that a
-- Postgres FK ON DELETE CASCADE trigger runs independently of the deleting
-- role's own grants/RLS policies on the child table (the same behavior
-- EntityOffboardingPurgeProcessor's own header comment already documents), so
-- no grant is needed for those two tables at all.
--
-- Every DELETE below also needs SELECT on the table — confirmed empirically,
-- not assumed: Postgres's DELETE privilege model requires SELECT on any
-- column a WHERE clause references (`WHERE "studentRankId" = ...` here), on
-- top of the DELETE privilege itself; a first draft of this migration only
-- granted DELETE on StudentRankSkillStatus/PromotionEvent and hit
-- "permission denied" on every call despite the DELETE grant being correct —
-- StudentRank alone had SELECT already granted for this role (needed for the
-- initial lookup query), which is why only those two tables failed.
GRANT SELECT, DELETE ON "StudentRankSkillStatus" TO ultm8_grading_erasure;
CREATE POLICY "student_rank_skill_status_grading_erasure_select" ON "StudentRankSkillStatus" FOR SELECT TO ultm8_grading_erasure USING (true);
CREATE POLICY "student_rank_skill_status_grading_erasure_delete" ON "StudentRankSkillStatus" FOR DELETE TO ultm8_grading_erasure USING (true);

GRANT SELECT, DELETE ON "PromotionEvent" TO ultm8_grading_erasure;
CREATE POLICY "promotion_event_grading_erasure_select" ON "PromotionEvent" FOR SELECT TO ultm8_grading_erasure USING (true);
CREATE POLICY "promotion_event_grading_erasure_delete" ON "PromotionEvent" FOR DELETE TO ultm8_grading_erasure USING (true);

GRANT SELECT, DELETE ON "StudentRank" TO ultm8_grading_erasure;
CREATE POLICY "student_rank_grading_erasure_select" ON "StudentRank" FOR SELECT TO ultm8_grading_erasure USING (true);
CREATE POLICY "student_rank_grading_erasure_delete" ON "StudentRank" FOR DELETE TO ultm8_grading_erasure USING (true);
