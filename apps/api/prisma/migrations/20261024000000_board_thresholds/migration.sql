-- Grading Board columns per style (Decisions 75, 136, 181): Getting There
-- from boardGettingThere %, Ready to Grade from boardReadyToGrade %.
-- 33 / 66 by default; whole percentages, 1–99, Getting There below Ready.
ALTER TABLE "Discipline"
  ADD COLUMN "boardGettingThere" INTEGER NOT NULL DEFAULT 33,
  ADD COLUMN "boardReadyToGrade" INTEGER NOT NULL DEFAULT 66,
  ADD CONSTRAINT "Discipline_board_thresholds_check"
    CHECK ("boardGettingThere" >= 1 AND "boardReadyToGrade" <= 99 AND "boardGettingThere" < "boardReadyToGrade");
