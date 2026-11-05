-- Decision 433 item 10 (stress test round 5, PRIV-10): the owner's "Download
-- this member's data" is logged on StudentExportLog, with the member it was
-- about. Nullable, no default and no foreign key, so it is safe on a live
-- table (no rewrite) and the log row outlives the member's account. ultm8_jobs
-- already has SELECT/INSERT/UPDATE/DELETE on the whole table.
ALTER TABLE "StudentExportLog" ADD COLUMN IF NOT EXISTS "studentId" TEXT;
