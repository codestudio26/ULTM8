-- Decision 422 item 8: merging duplicate members no longer refuses when both
-- records have a belt in the same style. MemberMergeService decides which
-- belt is kept (the higher, by the ladder's order; the kept member's on the
-- same rung) and which waiting promotion fees close; this function only does
-- the writes. The other belt's history moves onto the kept belt, marked with
-- the member record it came from; only the other StudentRank row is deleted.

-- 1. The mark on a history entry that came from the belt that was not kept.
ALTER TABLE "PromotionEvent" ADD COLUMN "mergedFromUserId" TEXT;

-- 2. The writes, in one narrow function. ultm8_jobs gets no new table or
-- column grant: it may only call this. SECURITY DEFINER, owned by the
-- BYPASSRLS helper role with search_path pinned, like the other helper
-- functions. It refuses unless:
-- - both members are current Students of the School, and the closer is a
--   current School Owner/Manager there;
-- - every belt pair is two different StudentRank rows of that School, one
--   each for the two members, in the same style;
-- - every fee is that School's, one of the two members', waiting for its fee
--   and unanswered (PENDING, no promotion applied, not "to decide").
-- So it can only ever touch those two members' rows at that School.
--
-- p_folds: [{"keep": "<StudentRank id>", "drop": "<StudentRank id>", "sameRung": true|false}, ...]
-- For each pair:
-- - same rung: per skill the further sign-off status is kept (the enum is
--   ordered Not started < Learning < Signed off); the dropped belt's
--   statuses for skills the kept belt has none for move to it; the classes
--   toward the next rung (total and per type) are added together;
-- - different rung: the dropped belt's statuses go, as on any rank change
--   (Decision 128 item 16);
-- - the dropped belt's sign-off log and history entries move to the kept
--   belt, the entries marked with the member they were on; then the dropped
--   StudentRank row is deleted.
-- Returns the number of belts folded.
CREATE FUNCTION "merge_student_ranks"(
  p_school_id TEXT,
  p_kept_user_id TEXT,
  p_dup_user_id TEXT,
  p_closed_by_id TEXT,
  p_folds JSONB,
  p_cancel_fee_ids TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  f JSONB;
  k public."StudentRank"%ROWTYPE;
  d public."StudentRank"%ROWTYPE;
  folded INTEGER := 0;
  cancelled INTEGER;
BEGIN
  IF p_school_id IS NULL OR p_kept_user_id IS NULL OR p_dup_user_id IS NULL OR p_kept_user_id = p_dup_user_id THEN
    RAISE EXCEPTION 'merge_student_ranks: two different members are required';
  END IF;
  IF (SELECT count(DISTINCT g."userId") FROM public."RoleGrant" g
      WHERE g."schoolId" = p_school_id AND g."userId" IN (p_kept_user_id, p_dup_user_id)
        AND g."role" = 'STUDENT' AND g."revokedAt" IS NULL) <> 2 THEN
    RAISE EXCEPTION 'merge_student_ranks: both members must be current Students of the School';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."RoleGrant" g
      WHERE g."schoolId" = p_school_id AND g."userId" = p_closed_by_id
        AND g."role" = 'SCHOOL_OWNER_MANAGER' AND g."revokedAt" IS NULL) THEN
    RAISE EXCEPTION 'merge_student_ranks: the merge must be made by the School owner';
  END IF;

  FOR f IN SELECT * FROM pg_catalog.jsonb_array_elements(COALESCE(p_folds, '[]'::JSONB)) LOOP
    SELECT * INTO k FROM public."StudentRank" r WHERE r."id" = f->>'keep' AND r."schoolId" = p_school_id FOR UPDATE;
    SELECT * INTO d FROM public."StudentRank" r WHERE r."id" = f->>'drop' AND r."schoolId" = p_school_id FOR UPDATE;
    IF k."id" IS NULL OR d."id" IS NULL OR k."id" = d."id" OR k."disciplineId" <> d."disciplineId"
       OR NOT ((k."studentId" = p_kept_user_id AND d."studentId" = p_dup_user_id)
            OR (k."studentId" = p_dup_user_id AND d."studentId" = p_kept_user_id)) THEN
      RAISE EXCEPTION 'merge_student_ranks: each pair must be the two members'' belts in one style at the School';
    END IF;

    IF (f->>'sameRung')::BOOLEAN THEN
      UPDATE public."StudentRankSkillStatus" ks
      SET "status" = ds."status", "updatedAt" = pg_catalog.now()
      FROM public."StudentRankSkillStatus" ds
      WHERE ks."studentRankId" = k."id" AND ds."studentRankId" = d."id"
        AND ks."skillId" = ds."skillId" AND ds."status" > ks."status";
      DELETE FROM public."StudentRankSkillStatus" ds
      WHERE ds."studentRankId" = d."id"
        AND EXISTS (SELECT 1 FROM public."StudentRankSkillStatus" ks WHERE ks."studentRankId" = k."id" AND ks."skillId" = ds."skillId");
      UPDATE public."StudentRankSkillStatus" SET "studentRankId" = k."id", "updatedAt" = pg_catalog.now()
      WHERE "studentRankId" = d."id";
      UPDATE public."StudentRank" SET
        "classesAttendedTowardCheckpoint" = k."classesAttendedTowardCheckpoint" + d."classesAttendedTowardCheckpoint",
        "classesAttendedByType" = COALESCE((
          SELECT pg_catalog.jsonb_object_agg(t.key, t.n)
          FROM (
            SELECT e.key, sum(e.value::NUMERIC) AS n
            FROM (
              SELECT * FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(k."classesAttendedByType") = 'object' THEN k."classesAttendedByType" ELSE '{}'::JSONB END)
              UNION ALL
              SELECT * FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(d."classesAttendedByType") = 'object' THEN d."classesAttendedByType" ELSE '{}'::JSONB END)
            ) e
            WHERE pg_catalog.jsonb_typeof(e.value) = 'number'
            GROUP BY e.key
          ) t
        ), '{}'::JSONB),
        "updatedAt" = pg_catalog.now()
      WHERE "id" = k."id";
    ELSE
      DELETE FROM public."StudentRankSkillStatus" WHERE "studentRankId" = d."id";
    END IF;

    -- The log references the belt ON DELETE CASCADE, so it moves first.
    UPDATE public."SkillSignOffLog" SET "studentRankId" = k."id" WHERE "studentRankId" = d."id";
    UPDATE public."PromotionEvent" SET "studentRankId" = k."id", "mergedFromUserId" = d."studentId" WHERE "studentRankId" = d."id";
    DELETE FROM public."StudentRank" WHERE "id" = d."id";
    folded := folded + 1;
  END LOOP;

  IF COALESCE(pg_catalog.array_length(p_cancel_fee_ids, 1), 0) > 0 THEN
    UPDATE public."PromotionFeeRequest"
    SET "status" = 'CANCELLED', "cancelledAt" = pg_catalog.now(), "closedById" = p_closed_by_id, "updatedAt" = pg_catalog.now()
    WHERE "id" = ANY (p_cancel_fee_ids)
      AND "schoolId" = p_school_id
      AND "studentId" IN (p_kept_user_id, p_dup_user_id)
      AND "status" = 'PENDING' AND "promotionWaits" AND "promotionEventId" IS NULL AND "toDecideAt" IS NULL;
    GET DIAGNOSTICS cancelled = ROW_COUNT;
    IF cancelled <> pg_catalog.array_length(p_cancel_fee_ids, 1) THEN
      RAISE EXCEPTION 'merge_student_ranks: a fee to cancel is not an unanswered waiting fee of these members at the School';
    END IF;
  END IF;

  RETURN folded;
END;
$$;

ALTER FUNCTION "merge_student_ranks"(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT[]) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "merge_student_ranks"(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "merge_student_ranks"(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT[]) TO ultm8_jobs;

-- What the function's owner needs, and nothing more. ultm8_rls_helper is
-- NOLOGIN and already reads RoleGrant, StudentRank and StudentRankSkillStatus.
GRANT UPDATE ("status", "studentRankId", "updatedAt"), DELETE ON "StudentRankSkillStatus" TO ultm8_rls_helper;
GRANT UPDATE ("classesAttendedTowardCheckpoint", "classesAttendedByType", "updatedAt"), DELETE ON "StudentRank" TO ultm8_rls_helper;
GRANT SELECT ("studentRankId"), UPDATE ("studentRankId") ON "SkillSignOffLog" TO ultm8_rls_helper;
GRANT SELECT ("studentRankId", "studentId"), UPDATE ("studentRankId", "mergedFromUserId") ON "PromotionEvent" TO ultm8_rls_helper;
GRANT SELECT ("id", "schoolId", "studentId", "status", "promotionWaits", "promotionEventId", "toDecideAt"),
  UPDATE ("status", "cancelledAt", "closedById", "updatedAt") ON "PromotionFeeRequest" TO ultm8_rls_helper;
