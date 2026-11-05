-- Decision 316 item 10: income categories. Each School names its own list; a
-- membership plan, a staff-created charge and a recurring charge can each
-- carry one, and the Transactions export shows it. No accounting codes and no
-- accounting integration (Decision 338).
CREATE TABLE "IncomeCategory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncomeCategory_schoolId_name_key" ON "IncomeCategory"("schoolId", "name");
-- Target of the (incomeCategoryId, schoolId) keys below.
CREATE UNIQUE INDEX "IncomeCategory_id_schoolId_key" ON "IncomeCategory"("id", "schoolId");

ALTER TABLE "IncomeCategory" ADD CONSTRAINT "IncomeCategory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MembershipPlan" ADD COLUMN "incomeCategoryId" TEXT;
ALTER TABLE "Charge" ADD COLUMN "incomeCategoryId" TEXT;
ALTER TABLE "RecurringCharge" ADD COLUMN "incomeCategoryId" TEXT;

-- NO ACTION, not RESTRICT: a category in use can't be deleted, but a School
-- deleted by the purge job takes its plans and categories in one statement,
-- which NO ACTION (checked at the end of the statement) allows.
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_incomeCategoryId_fkey" FOREIGN KEY ("incomeCategoryId") REFERENCES "IncomeCategory"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_incomeCategoryId_fkey" FOREIGN KEY ("incomeCategoryId") REFERENCES "IncomeCategory"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_incomeCategoryId_fkey" FOREIGN KEY ("incomeCategoryId") REFERENCES "IncomeCategory"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- (incomeCategoryId, schoolId) together, written by hand (Prisma can't model
-- an optional relation over a required column): a row can only carry a
-- category of its own School, whatever the API sends. A null category skips
-- the check (MATCH SIMPLE).
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_incomeCategory_same_school_fkey" FOREIGN KEY ("incomeCategoryId", "schoolId") REFERENCES "IncomeCategory"("id", "schoolId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_incomeCategory_same_school_fkey" FOREIGN KEY ("incomeCategoryId", "schoolId") REFERENCES "IncomeCategory"("id", "schoolId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_incomeCategory_same_school_fkey" FOREIGN KEY ("incomeCategoryId", "schoolId") REFERENCES "IncomeCategory"("id", "schoolId") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "MembershipPlan_incomeCategoryId_idx" ON "MembershipPlan"("incomeCategoryId");
CREATE INDEX "Charge_incomeCategoryId_idx" ON "Charge"("incomeCategoryId");
CREATE INDEX "RecurringCharge_incomeCategoryId_idx" ON "RecurringCharge"("incomeCategoryId");

-- Read and written only on the jobs connection, after the API's own staff
-- checks (IncomeCategoriesService), as SchoolTag is. ultm8_app gets nothing,
-- so no member-facing query can reach the list. A plan's or a charge's own
-- incomeCategoryId column is covered by those tables' existing grants.
ALTER TABLE "IncomeCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncomeCategory" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "IncomeCategory" TO ultm8_jobs;
CREATE POLICY "income_category_jobs_all" ON "IncomeCategory" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
