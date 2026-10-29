-- Backlog 3.14 (Decision 318 item 5): a free trial of ULTM8 for a School,
-- managed only by ULTM8 HQ in Platform Admin. No card up front; when it ends
-- without an active platform subscription the School is read-only until it
-- subscribes. Nothing is deleted.
ALTER TABLE "School" ADD COLUMN "platformTrialStartedAt" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "platformTrialEndsAt" TIMESTAMP(3);

-- Platform Admin reads and sets the trial on its own connection, column by
-- column like the lifecycle columns (20261006000000_tenant_lifecycle_module),
-- and reads the subscription status it is judged against.
GRANT SELECT ("platformTrialStartedAt", "platformTrialEndsAt", "platformSubscriptionStatus") ON "School" TO ultm8_platform_admin;
GRANT UPDATE ("platformTrialStartedAt", "platformTrialEndsAt", "updatedAt") ON "School" TO ultm8_platform_admin;
