-- Backlog 3.20 (Decisions 281, 285, 298): Kids and Adult stay separate styles,
-- each with its own ladder and skills; a Kids style is linked to its Adult
-- style, and a kid can be graded into it from "Ready for Adult from age".
ALTER TABLE "Discipline" ADD COLUMN "adultDisciplineId" TEXT;
ALTER TABLE "Discipline" ADD COLUMN "readyForAdultAge" INTEGER NOT NULL DEFAULT 16;
CREATE INDEX "Discipline_adultDisciplineId_idx" ON "Discipline"("adultDisciplineId");
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_adultDisciplineId_fkey" FOREIGN KEY ("adultDisciplineId") REFERENCES "Discipline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
