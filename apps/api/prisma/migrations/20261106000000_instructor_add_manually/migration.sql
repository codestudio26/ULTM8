-- Decision 1/230 (POST-SPEC-55-DECISION-LOG.md) — Instructor "Add Manually":
-- a real User/RoleGrant/Instructor record is created immediately from just
-- name+email, with phone/dateOfBirth deferred to self-service profile
-- completion, and a server-generated temp passcode forced to change on first
-- login. Supersedes Decision 206/211's unbuilt account-claim-invitation
-- design for this same problem.

-- AlterTable
ALTER TABLE "User"
  ALTER COLUMN "phone" DROP NOT NULL,
  ALTER COLUMN "dateOfBirth" DROP NOT NULL,
  ADD COLUMN "mustChangePasscode" BOOLEAN NOT NULL DEFAULT false;

-- Decision 1/217 — the four missing Instructor fields (Address, a second
-- Activities list distinct from specializations, Certification upload,
-- consent).
-- AlterTable
ALTER TABLE "Instructor"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "certificationKey" TEXT,
  ADD COLUMN "certificationConsentedAt" TIMESTAMP(3);
