-- Decision 391: Visitors (Decision 315 item 1). A visit pass is a free
-- Membership on the School's one hidden VISIT_PASS plan; the School sets how
-- long a pass lasts.
ALTER TYPE "MembershipPlanType" ADD VALUE 'VISIT_PASS';

ALTER TABLE "School" ADD COLUMN "visitorPeriodDays" INTEGER;
