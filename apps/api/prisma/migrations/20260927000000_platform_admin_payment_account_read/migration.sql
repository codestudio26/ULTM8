-- ULTM8 Phase 30 — PlatformAdminModule Slice 6: GET .../payment-account, a third
-- cross-tenant admin read entity. Same ultm8_platform_admin role from
-- 20260925000000_platform_admin_audit_log, no new role needed, just extending its
-- grants to a third table — but the FIRST cross-tenant read this module restricts to
-- a specific subRole rather than opening to all three tiers, per
-- ultm8-tenant-isolation SKILL.md §3's explicit, confirmed split: "Billing/Payments
-- Ops — can view PaymentAccount configuration status and initiate a Stripe Connect
-- credential rotation, but never sees a decrypted secret." Support's own bullet
-- explicitly lists "a Stripe Connected Account id" among what it must never see, and
-- nothing in that same section confirms Support gets PaymentAccount-configuration
-- visibility at all (only "payment status" as part of general School/Franchise
-- account metadata, already covered by the existing unrestricted School/Franchise
-- reads' own franchiseFeeSubscriptionStatus-style fields) — so this read is
-- BILLING_PAYMENTS_OPS + FULL_ADMIN only, enforced in
-- PlatformAdminPaymentAccountsService, not guessed wider than the spec confirms.
--
-- payment_account_tenant_isolation (20260911000000_payments_module) references
-- RoleGrant.schoolId, RoleGrant.franchiseId, RoleGrant.userId, RoleGrant.revokedAt in
-- its own OR'd EXISTS clauses (no explicit `TO ultm8_app`, so PostgreSQL's default
-- `TO PUBLIC` means ultm8_platform_admin's own queries are subject to it too, same
-- "unrelated policy in the OR-evaluation path" gotcha School/Franchise's own
-- migrations already documented) — but all four of those exact columns were already
-- granted to ultm8_platform_admin across the two prior migrations (schoolId/userId/
-- revokedAt from School's own read, franchiseId/userId/revokedAt from Franchise's),
-- so no new RoleGrant grant is needed here — GRANT is additive per-column, and the
-- union of the two prior grants already covers every column this policy touches.

-- PaymentAccount — deliberately excludes stripeConnectedAccountId, same "deliberately
-- not exposed" treatment this codebase already gives other internal Stripe
-- correlator ids (Franchise.stripeMeterId/stripeUsagePriceId, School's own
-- stripeFranchiseFeeSubscriptionId) — Support's own confirmed exclusion of this exact
-- field (see this migration's own header comment) makes it the more conservative,
-- spec-aligned default for Platform Admin generally, not just for Support
-- specifically; nothing confirms Billing/Payments Ops needs the raw id merely to
-- VIEW configuration status (as opposed to actually initiating a rotation, a
-- separate, undesigned write path — see PlatformAdminModule's own header comment).
GRANT SELECT (
  "id", "schoolId", "franchiseId", "provider", "accountTitle", "country", "status",
  "mode", "createdAt", "updatedAt"
) ON "PaymentAccount" TO ultm8_platform_admin;

CREATE POLICY "platform_admin_payment_account_read" ON "PaymentAccount"
  FOR SELECT
  TO ultm8_platform_admin
  USING (true);
