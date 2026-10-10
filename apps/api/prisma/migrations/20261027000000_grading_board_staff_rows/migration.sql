-- The Grading Board for staff in one query (Phase 7 stress round, finding 1;
-- approved by the product owner). Before, the API read each visible student
-- in their own transaction under that student's context (StudentRank and
-- Membership are owner-or-self, Decision 88): 7 s for a coach with 769
-- students, 30 s at a 3,000-student School without branches.
--
-- grading_board_rows() returns the same rows for the calling staff member,
-- under the same rule (Decisions 168, 169, 177): an active INSTRUCTOR or
-- BRANCH_STAFF grant at the School is required; in a School with branches,
-- the students whose home branch is one of the caller's branches; in a
-- School without branches, every enrolled student. Only students with an
-- active STUDENT grant and a rank in that style. Impersonation-scoped like
-- the other helpers. It returns names, the student's rank in that style with
-- its skill sign-offs, the home branch's time zone and membership status
-- fields — what the board shows — and nothing else.

GRANT SELECT ON "User" TO ultm8_rls_helper;
GRANT SELECT ON "StudentRank" TO ultm8_rls_helper;
GRANT SELECT ON "StudentRankSkillStatus" TO ultm8_rls_helper;
GRANT SELECT ON "Membership" TO ultm8_rls_helper;
GRANT SELECT ON "StudentHomeBranch" TO ultm8_rls_helper;

CREATE FUNCTION "grading_board_rows"(p_school_id text, p_discipline_id text)
RETURNS TABLE (
  "studentId" text, "firstName" text, "surname" text, "homeTimeZone" text,
  "studentRank" jsonb, "memberships" jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH my_grants AS (
    SELECT rg."branchId" FROM public."RoleGrant" rg
    WHERE rg."userId" = current_setting('app.current_user_id', true)
      AND rg."schoolId" = p_school_id
      AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
      AND rg."revokedAt" IS NULL
  ),
  allowed AS (
    SELECT EXISTS (SELECT 1 FROM my_grants)
      AND (
        current_setting('app.impersonation_school_id', true) IS NULL
        OR current_setting('app.impersonation_school_id', true) = ''
        OR current_setting('app.impersonation_school_id', true) = p_school_id
      ) AS ok,
      EXISTS (SELECT 1 FROM public."Branch" WHERE "schoolId" = p_school_id) AS has_branches
  ),
  students AS (
    SELECT DISTINCT rg."userId" AS sid FROM public."RoleGrant" rg
    WHERE rg."schoolId" = p_school_id AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
  )
  SELECT u."id", u."firstName", u."surname", b."timezone",
    to_jsonb(sr) || jsonb_build_object(
      'skillStatuses',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('skillId', ss."skillId", 'status', ss."status"))
                FROM public."StudentRankSkillStatus" ss WHERE ss."studentRankId" = sr."id"), '[]'::jsonb)
    ),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('status', m."status", 'expiryDate', m."expiryDate", 'classesRemaining', m."classesRemaining"))
              FROM public."Membership" m WHERE m."schoolId" = p_school_id AND m."studentId" = u."id"), '[]'::jsonb)
  FROM students s
  CROSS JOIN allowed a
  JOIN public."User" u ON u."id" = s.sid
  JOIN public."StudentRank" sr ON sr."studentId" = s.sid AND sr."disciplineId" = p_discipline_id AND sr."schoolId" = p_school_id
  LEFT JOIN public."StudentHomeBranch" h ON h."schoolId" = p_school_id AND h."studentId" = s.sid
  LEFT JOIN public."Branch" b ON b."id" = h."branchId"
  WHERE a.ok
    AND (NOT a.has_branches OR h."branchId" IN (SELECT g."branchId" FROM my_grants g WHERE g."branchId" IS NOT NULL));
$$;
ALTER FUNCTION "grading_board_rows"(text, text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "grading_board_rows"(text, text) TO ultm8_app;
