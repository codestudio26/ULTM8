-- v1.2 backend backlog — Membership Plans "Archive" action. Distinct from
-- the existing `visible` flag (which only governs whether Students
-- browsing can see/purchase it themselves): archiving blocks every NEW
-- purchase, Staff-on-behalf-of included (MembershipsService.purchase()),
-- and is filtered out of the School Owner's own list by default, same
-- client-side-filter convention `visible`'s own Visible/Hidden stat tiles
-- already use. Reversible at any time (set back to NULL) — no purge/
-- grace-period, unlike Decision 110's tenant-offboarding archive; a
-- retired plan's historical data must stay forever for Transaction/
-- Membership references, and archiving never touches a Membership
-- already sold on this plan.

-- AlterTable
ALTER TABLE "MembershipPlan" ADD COLUMN "archivedAt" TIMESTAMP(3);
