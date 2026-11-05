-- Stress test round 5, PRIV-9 (Decision 432): a School or Franchise with no
-- RoleGrant at all was readable by every signed-in user. The bootstrap clause
-- `OR NOT school_has_any_role_grant(id)` (20260906000000; the Franchise copy
-- in 20260920000000) exists only so the person creating a School or Franchise
-- can read it back in the same request, before its first owner grant is
-- written. Left open, a School whose grants all disappeared (RoleGrant.userId
-- is ON DELETE CASCADE, so deleting the last person would do it) became
-- readable by anyone: name and address, though its students stayed hidden.
--
-- The clause now holds only in the minute after the row was created.
-- createdAt is timestamp(3) without time zone, written in UTC by Prisma; the
-- column default (CURRENT_TIMESTAMP) would write the session's local time, so
-- the earlier of the two clocks is used and either way of writing it passes.
-- Everything else in both policies is unchanged.

ALTER POLICY "school_tenant_isolation" ON "School"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "School"."id"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR (
      NOT school_has_any_role_grant("School"."id")
      AND "School"."createdAt" >= least(now() AT TIME ZONE 'UTC', localtimestamp) - interval '1 minute'
    )
  )
  WITH CHECK (current_setting('app.current_user_id', true) IS NOT NULL);

ALTER POLICY "franchise_tenant_isolation" ON "Franchise"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."franchiseId" = "Franchise"."id"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR (
      NOT franchise_has_any_role_grant("Franchise"."id")
      AND "Franchise"."createdAt" >= least(now() AT TIME ZONE 'UTC', localtimestamp) - interval '1 minute'
    )
  )
  WITH CHECK (current_setting('app.current_user_id', true) IS NOT NULL);
