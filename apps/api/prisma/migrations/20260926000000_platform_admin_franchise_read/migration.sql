-- ULTM8 Phase 27 — PlatformAdminModule Slice 3: GET /platform-admin/franchises/:id,
-- the second cross-tenant admin read (mirrors Slice 2's GET /platform-admin/schools/:id
-- exactly — same ultm8_platform_admin role from
-- 20260925000000_platform_admin_audit_log, no new role needed, just extending its
-- grants to a second table).
--
-- franchise_tenant_isolation (the init migration) has the identical shape to
-- school_tenant_isolation: no explicit `TO ultm8_app`, so PostgreSQL's default
-- (TO PUBLIC) means ultm8_platform_admin needs the same defensive SELECT grant on
-- RoleGrant's own referenced columns purely so PostgreSQL can evaluate that
-- unrelated policy's OR-branch at query-rewrite time — franchiseId is the one new
-- column here (userId/revokedAt were already granted for school_tenant_isolation's
-- own EXISTS clause in the prior migration; GRANT is additive/idempotent per-column,
-- re-stating them alongside franchiseId here keeps this migration self-contained
-- and readable on its own rather than relying on the reader to cross-reference the
-- prior one for the full picture).

GRANT SELECT ("franchiseId", "userId", "revokedAt") ON "RoleGrant" TO ultm8_platform_admin;

-- Franchise — same curated column set as FRANCHISE_PUBLIC_SELECT
-- (apps/api/src/tenants/franchises/franchises.service.ts), same "deliberately not
-- exposed" treatment for stripeMeterId/stripeUsagePriceId (internal Stripe
-- correlator ids with no direct caller action tied to them) that constant's own
-- header comment already established.
GRANT SELECT (
  "id", "name", "mobileNumber", "address", "type", "activities", "facilities",
  "defaultLanguage", "defaultCurrency", "description", "logoUrl", "bannerUrl",
  "feeModel", "flatFeeAmount", "perHeadcountRate", "createdAt", "updatedAt"
) ON "Franchise" TO ultm8_platform_admin;

CREATE POLICY "platform_admin_franchise_read" ON "Franchise"
  FOR SELECT
  TO ultm8_platform_admin
  USING (true);
