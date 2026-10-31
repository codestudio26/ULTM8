-- Kids → Adult: the move is charged like any other promotion (Decision 419
-- item 2; backlog 3.20). Additive.
--
-- A promotion fee request for a move into the linked Adult program keeps the
-- Kids style as its `disciplineId` (the style the student is graded from, where
-- `expectedCurrentRungId` is, and where a waiting move holds further grading)
-- and records the Adult style here, where `toRungId` is. Null for every grade
-- within one style. The existing table grants and RLS policies cover it.

-- AlterTable
ALTER TABLE "PromotionFeeRequest" ADD COLUMN "toDisciplineId" TEXT;

-- CreateIndex
CREATE INDEX "PromotionFeeRequest_toDisciplineId_idx" ON "PromotionFeeRequest"("toDisciplineId");

-- AddForeignKey
ALTER TABLE "PromotionFeeRequest" ADD CONSTRAINT "PromotionFeeRequest_toDisciplineId_fkey" FOREIGN KEY ("toDisciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
