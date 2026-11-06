-- Decision 316 item 5, as answered by Decision 435 items 10-15: a member
-- limit on a plan, and a waiting list when it is full.
--   10. Live and frozen members, and Cash/Bank payments still waiting, count.
--   11. A freed place is held 24 hours for the first person waiting, then
--       passes to the next.
--   12. Owners and staff can sell over the limit at the desk; members can't
--       buy over it.
--   13. A number on the plan; blank = no limit.
--   14. A parent can put their child on the waiting list.
--   15. Lowering the limit keeps current members; the plan is closed to new
--       buyers until there is room.

CREATE TYPE "PlanWaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'BOUGHT', 'EXPIRED', 'LEFT');

-- MembershipPlan's existing grants and policies apply.
ALTER TABLE "MembershipPlan" ADD COLUMN "memberLimit" INTEGER;
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_memberLimit_positive" CHECK ("memberLimit" IS NULL OR "memberLimit" >= 1);
-- The app's list of a School's plans says which have a limit.
GRANT SELECT ("memberLimit") ON "MembershipPlan" TO ultm8_discovery;

CREATE TABLE "PlanWaitlistEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "membershipPlanId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedById" TEXT NOT NULL,
    "status" "PlanWaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offeredAt" TIMESTAMP(3),
    "offerExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanWaitlistEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanWaitlistEntry_offer_valid" CHECK ("status" <> 'OFFERED' OR ("offeredAt" IS NOT NULL AND "offerExpiresAt" IS NOT NULL))
);

CREATE INDEX "PlanWaitlistEntry_schoolId_idx" ON "PlanWaitlistEntry"("schoolId");
CREATE INDEX "PlanWaitlistEntry_membershipPlanId_status_createdAt_idx" ON "PlanWaitlistEntry"("membershipPlanId", "status", "createdAt");
CREATE INDEX "PlanWaitlistEntry_studentId_idx" ON "PlanWaitlistEntry"("studentId");
-- One open place in line per member and plan.
CREATE UNIQUE INDEX "PlanWaitlistEntry_one_open_per_member" ON "PlanWaitlistEntry"("membershipPlanId", "studentId") WHERE "status" IN ('WAITING', 'OFFERED');

ALTER TABLE "PlanWaitlistEntry" ADD CONSTRAINT "PlanWaitlistEntry_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanWaitlistEntry" ADD CONSTRAINT "PlanWaitlistEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlanWaitlistEntry" ADD CONSTRAINT "PlanWaitlistEntry_joinedById_fkey" FOREIGN KEY ("joinedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who sees an entry: the School's Owner/Manager, or the member themselves (a
-- parent acts under their child's context, as for buying). The member joins
-- and leaves their own line; nobody deletes through the app connection.
ALTER TABLE "PlanWaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanWaitlistEntry" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON "PlanWaitlistEntry" TO ultm8_app;
GRANT UPDATE ("status", "updatedAt") ON "PlanWaitlistEntry" TO ultm8_app;

CREATE POLICY "plan_waitlist_owner_or_self_read" ON "PlanWaitlistEntry"
  FOR SELECT
  USING (
    is_active_school_owner_manager("PlanWaitlistEntry"."schoolId")
    OR "PlanWaitlistEntry"."studentId" = current_setting('app.current_user_id', true)
  );
CREATE POLICY "plan_waitlist_self_insert" ON "PlanWaitlistEntry"
  FOR INSERT
  WITH CHECK ("PlanWaitlistEntry"."studentId" = current_setting('app.current_user_id', true) AND "PlanWaitlistEntry"."status" = 'WAITING');
CREATE POLICY "plan_waitlist_self_update" ON "PlanWaitlistEntry"
  FOR UPDATE
  USING ("PlanWaitlistEntry"."studentId" = current_setting('app.current_user_id', true))
  WITH CHECK ("PlanWaitlistEntry"."studentId" = current_setting('app.current_user_id', true));

-- Jobs connection: the waiting-list job offers, expires and closes entries;
-- a closed School's purge deletes them once the School is purged.
GRANT SELECT, DELETE ON "PlanWaitlistEntry" TO ultm8_jobs;
GRANT UPDATE ("status", "offeredAt", "offerExpiresAt", "updatedAt") ON "PlanWaitlistEntry" TO ultm8_jobs;
CREATE POLICY "plan_waitlist_jobs_read" ON "PlanWaitlistEntry"
  FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "plan_waitlist_jobs_update" ON "PlanWaitlistEntry"
  FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "plan_waitlist_jobs_delete_purged_school" ON "PlanWaitlistEntry"
  FOR DELETE TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "PlanWaitlistEntry"."schoolId" AND s."purgedAt" IS NOT NULL));

-- Items 10-11: how many places on a plan are taken by people other than
-- p_student_id: members with a live membership on it (ACTIVE, not past its
-- end, not a used-up pack; a frozen one is still ACTIVE, so it counts), a
-- Cash/Bank payment for it still waiting, and a place held for someone on the
-- waiting list. Each person counts once. A member can't see the others'
-- rows, so this answers one number about one plan, nothing else.
GRANT SELECT ("membershipPlanId", "studentId", "status", "paymentMethod", "membershipId", "kind") ON "Transaction" TO ultm8_rls_helper;
GRANT SELECT ON "PlanWaitlistEntry" TO ultm8_rls_helper;
CREATE FUNCTION "plan_places_taken"(p_plan_id text, p_student_id text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT count(DISTINCT x."studentId")::integer FROM (
    SELECT m."studentId" FROM public."Membership" m
    WHERE m."membershipPlanId" = p_plan_id
      AND m."status" = 'ACTIVE'
      AND (m."expiryDate" IS NULL OR m."expiryDate" > now())
      AND (m."classesRemaining" IS NULL OR m."classesRemaining" > 0)
    UNION ALL
    SELECT t."studentId" FROM public."Transaction" t
    WHERE t."membershipPlanId" = p_plan_id
      AND t."kind" = 'MEMBERSHIP'
      AND t."status" = 'PENDING'
      AND t."paymentMethod" IN ('CASH', 'BANK_TRANSFER')
      AND t."membershipId" IS NULL
    UNION ALL
    SELECT w."studentId" FROM public."PlanWaitlistEntry" w
    WHERE w."membershipPlanId" = p_plan_id
      AND w."status" = 'OFFERED'
      AND w."offerExpiresAt" > now()
  ) x
  WHERE p_student_id IS NULL OR x."studentId" <> p_student_id;
$$;
ALTER FUNCTION "plan_places_taken"(text, text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "plan_places_taken"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "plan_places_taken"(text, text) TO ultm8_app, ultm8_jobs;

-- Item 11: a member's place in line on a plan (1 = next), or null when they
-- aren't waiting. The others in line stay hidden.
CREATE FUNCTION "plan_waitlist_position"(p_plan_id text, p_student_id text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT (
    SELECT count(*)::integer + 1 FROM public."PlanWaitlistEntry" o
    WHERE o."membershipPlanId" = p_plan_id AND o."status" = 'WAITING'
      AND (o."createdAt", o."id") < (me."createdAt", me."id")
  )
  FROM public."PlanWaitlistEntry" me
  WHERE me."membershipPlanId" = p_plan_id AND me."studentId" = p_student_id AND me."status" = 'WAITING';
$$;
ALTER FUNCTION "plan_waitlist_position"(text, text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "plan_waitlist_position"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "plan_waitlist_position"(text, text) TO ultm8_app;
