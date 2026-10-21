-- Decision 279 — new Schools start with a 60-minute waitlist claim window
-- instead of 120. Only the column default changes: every existing School keeps
-- whatever window it already has, and owners can still set any value.
ALTER TABLE "School" ALTER COLUMN "waitlistClaimWindowMinutes" SET DEFAULT 60;
