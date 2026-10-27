-- Waivers review W3: keep a copy of exactly what each person signed.
-- Existing signatures get no copy: the text they saw is not known.
ALTER TABLE "Waiver" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "WaiverSignature"
  ADD COLUMN "signedWaiverTitle" TEXT,
  ADD COLUMN "signedWaiverBody" TEXT,
  ADD COLUMN "signedWaiverSha256" TEXT,
  ADD COLUMN "signedWaiverVersion" INTEGER;
