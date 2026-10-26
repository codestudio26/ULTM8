-- Memberships follow-ups (Decision NNN): a Subscription cancelled by the
-- Student or the owner runs to the end of its paid period. These record when
-- it ends and who asked. Additive only.
ALTER TABLE "Membership" ADD COLUMN "cancelAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "cancelledById" TEXT;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
