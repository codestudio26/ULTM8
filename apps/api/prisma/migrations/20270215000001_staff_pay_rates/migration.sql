-- Decision 320 item 4: the payroll report's rates. Each staff member can have
-- an hourly rate and a per-class rate at a School, in the School's currency
-- (minor units). Both blank = no row, and the person is left out.
--
-- Pay data is the owner's only: the app connection reads and writes it under
-- is_active_school_owner_manager, the same policy StaffPermission's owner
-- side uses. There is no self-read policy (a staff member can't read their
-- own rate) and no grant to ultm8_jobs: nothing outside the owner's own
-- requests needs it.
CREATE TABLE "StaffPayRate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRate" INTEGER,
    "perClassRate" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPayRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffPayRate_rates_not_negative" CHECK (("hourlyRate" IS NULL OR "hourlyRate" >= 0) AND ("perClassRate" IS NULL OR "perClassRate" >= 0)),
    -- A row with both rates blank is deleted instead (the person is left out).
    CONSTRAINT "StaffPayRate_has_a_rate" CHECK ("hourlyRate" IS NOT NULL OR "perClassRate" IS NOT NULL)
);

CREATE INDEX "StaffPayRate_userId_idx" ON "StaffPayRate"("userId");
CREATE UNIQUE INDEX "StaffPayRate_schoolId_userId_key" ON "StaffPayRate"("schoolId", "userId");

-- Cascade: rates mean nothing without their School or person, and must never
-- block a School's purge (Decision 110).
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPayRate" ADD CONSTRAINT "StaffPayRate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "StaffPayRate" TO ultm8_app;

ALTER TABLE "StaffPayRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffPayRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_pay_rate_owner_manage" ON "StaffPayRate"
  USING (is_active_school_owner_manager("StaffPayRate"."schoolId"))
  WITH CHECK (is_active_school_owner_manager("StaffPayRate"."schoolId"));
