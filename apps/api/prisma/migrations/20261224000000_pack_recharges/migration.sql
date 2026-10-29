-- Decision 393 (Decision 316 item 7, handover F8): a used-up Class Pack at
-- check-in offers the same pack in the member's app; the desk finishes the
-- check-in once it is paid.
CREATE TABLE "PackRecharge" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "membershipPlanId" TEXT NOT NULL,
    "classIds" TEXT[],
    "requestedById" TEXT NOT NULL,
    "frontDeskSessionId" TEXT,
    "checkInMethod" "CheckInMethod" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackRecharge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PackRecharge_studentId_completedAt_idx" ON "PackRecharge"("studentId", "completedAt");
CREATE INDEX "PackRecharge_schoolId_idx" ON "PackRecharge"("schoolId");

ALTER TABLE "PackRecharge" ADD CONSTRAINT "PackRecharge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackRecharge" ADD CONSTRAINT "PackRecharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackRecharge" ADD CONSTRAINT "PackRecharge_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks
-- (PackRechargesService): the desk, the tablet and the member's app (or their
-- Guardian's) each reach it, and no one tenant policy fits all three.
ALTER TABLE "PackRecharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PackRecharge" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PackRecharge" TO ultm8_jobs;
CREATE POLICY "pack_recharge_jobs_all" ON "PackRecharge" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
