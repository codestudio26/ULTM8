-- Kids → Adult: the move is charged like any other promotion (Decision 419
-- item 2; backlog 3.20), behind its own owner switch (Decision 420 item 3).
-- Additive.
--
-- 1. School.promotionFeeKidsToAdult: "Charge a fee when moving a student from
--    Kids to Adult", off by default, in effect only while the School's
--    promotion fee is on. Off: the move is always free. Covered by the
--    existing School grants and RLS, as the other promotion fee switches.
-- 2. A promotion fee request for a move into the linked Adult program keeps
--    the Kids style as its `disciplineId` (the style the student is graded
--    from, where `expectedCurrentRungId` is, and where a waiting move holds
--    further grading) and records the Adult style in `toDisciplineId`, where
--    `toRungId` is. Null for every grade within one style. The existing table
--    grants and RLS policies cover it.

-- AlterTable
ALTER TABLE "School" ADD COLUMN "promotionFeeKidsToAdult" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PromotionFeeRequest" ADD COLUMN "toDisciplineId" TEXT;

-- CreateIndex
CREATE INDEX "PromotionFeeRequest_toDisciplineId_idx" ON "PromotionFeeRequest"("toDisciplineId");

-- AddForeignKey
ALTER TABLE "PromotionFeeRequest" ADD CONSTRAINT "PromotionFeeRequest_toDisciplineId_fkey" FOREIGN KEY ("toDisciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
