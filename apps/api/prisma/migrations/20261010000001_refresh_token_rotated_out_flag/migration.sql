-- FOUND ON REVIEW (this phase's own e2e pass, see RefreshToken's own Prisma
-- model comment): logout() and rotation both only ever set revokedAt, so
-- refresh()'s reuse-detection couldn't tell an ordinary logged-out token apart
-- from an actual replayed/stolen one — a logged-out token being refreshed
-- again wrongly mass-revoked every OTHER session for that User too. This flag
-- is the fix: only AuthService.refresh()'s own rotation step ever sets it true.

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN "rotatedOut" BOOLEAN NOT NULL DEFAULT false;
