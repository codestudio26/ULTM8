-- Decision 318 item 8: a School can let children sign their own waivers from
-- an age it sets. Off by default (null): a parent or guardian signs.
ALTER TABLE "School" ADD COLUMN "waiverChildSignsFromAge" INTEGER;
ALTER TABLE "School" ADD CONSTRAINT "School_waiverChildSignsFromAge_check"
  CHECK ("waiverChildSignsFromAge" IS NULL OR "waiverChildSignsFromAge" BETWEEN 1 AND 17);

-- A child who signed in their parent's app: signedById is the child, and this
-- keeps the parent's account (a plain id, like mergedIntoStudentId). No new
-- grants: ultm8_app and ultm8_jobs already have table-level access.
ALTER TABLE "WaiverSignature" ADD COLUMN "signedViaGuardianId" TEXT;
