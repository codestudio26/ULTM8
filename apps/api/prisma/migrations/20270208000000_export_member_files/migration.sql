-- The owner's signed-documents export can include member files (Decision 422
-- item 9). Additive. The existing table grant and RLS policy on
-- "SignedDocumentExport" (jobs connection only) cover the new columns.
--
-- 1. includeMemberFiles: the owner ticked "Include member files" when asking
--    for the export. Off by default, so exports without the tick are
--    unchanged.
-- 2. memberFileCount: how many member files the ZIP holds, once it is made.

-- AlterTable
ALTER TABLE "SignedDocumentExport" ADD COLUMN "includeMemberFiles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "memberFileCount" INTEGER;
