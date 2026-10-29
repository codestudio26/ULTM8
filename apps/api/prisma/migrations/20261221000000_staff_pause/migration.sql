-- Decision 390: "Pause" on the Staff page. Pausing someone ends each of their
-- coach and Branch Staff roles at the School the ordinary way (revokedAt), so
-- every access check, RLS helper and job already treats them as gone, and
-- marks those same rows paused. Unpausing clears both and the same roles come
-- back, at the same branches, with everything else the School set for them
-- (access switches, grading permissions, display name) left as it was.
-- A row with "pausedAt" set always has "revokedAt" set too.
ALTER TABLE "RoleGrant" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "RoleGrant" ADD COLUMN "pausedById" TEXT;
ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_paused_is_revoked" CHECK ("pausedAt" IS NULL OR "revokedAt" IS NOT NULL);
