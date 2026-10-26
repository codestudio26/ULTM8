-- Decision 350 — a member School shows its Franchise's name and logo only when
-- both owners allow it: the Franchise Owner's switch and the School Owner's.
-- Both start off, so nothing changes for existing Franchises and Schools.
ALTER TABLE "Franchise" ADD COLUMN "shareBrandingWithMembers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "showFranchiseBranding" BOOLEAN NOT NULL DEFAULT false;
