-- Phase 37: WaiversModule — Guardian-on-behalf-of signing (skills/ultm8-domain-
-- rules/SKILL.md §14, [CONFIRMED]: a Guardian has "full access to... waiver-
-- signing authority... for each linked minor"). A self-discovered gap, not a
-- spec gap: GuardianModule (Phase 12) shipped after WaiversModule (Phase 10)
-- and the two were never reconciled until now — see WaiversService's own
-- header comment.
--
-- Adds `signedById` — the actual human signer, which now diverges from
-- `studentId` (whose waiver this is) for a Guardian-signed row. NOT NULL:
-- every row states its real signer explicitly, no "absent means self"
-- convention. Backfilled from `studentId` for every pre-Phase-37 row, since
-- every signature before this phase was necessarily self-signed (no
-- Guardian-signing path existed yet to produce anything else).
--
-- No RLS policy change: every WaiverSignature write already runs under
-- withTenantContext(studentId, ...) — the row's own "self" branch of
-- waiver_signature_school_staff_or_self — regardless of who signedById is,
-- the same target-tenant-context substitution Booking's own Staff-on-behalf-of
-- write already established (Phase 11). signedById is not part of that
-- policy's predicate, so a Guardian-authored INSERT satisfies it exactly the
-- same way a self-signed one does.
ALTER TABLE "WaiverSignature" ADD COLUMN "signedById" TEXT;
UPDATE "WaiverSignature" SET "signedById" = "studentId" WHERE "signedById" IS NULL;
ALTER TABLE "WaiverSignature" ALTER COLUMN "signedById" SET NOT NULL;
ALTER TABLE "WaiverSignature" ADD CONSTRAINT "WaiverSignature_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id");
CREATE INDEX "WaiverSignature_signedById_idx" ON "WaiverSignature"("signedById");

-- No new table-level GRANT needed — same reasoning 20260928000000's own comment
-- gives for signatureImageKey: WaiverSignature already has a table-level grant
-- to ultm8_app, and a new column on an already-granted table needs none of its
-- own.
