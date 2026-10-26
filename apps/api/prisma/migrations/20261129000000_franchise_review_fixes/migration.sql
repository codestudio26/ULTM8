-- Decision 336 (Franchises review, F2) — the Franchise Owner's member-School
-- roster returned every column of every member School (`SELECT s.*`), including
-- the School's student join code and its internal Stripe subscription ids.
-- The roster only needs to show who the members are and how their franchise-fee
-- billing stands, so the function now returns exactly that.
--
-- It also stops trusting a caller id passed in as an argument: ownership is
-- checked against `app.current_user_id`, the same session setting every RLS
-- policy reads, so the function can only ever answer for the signed-in user.
-- Still SECURITY DEFINER and owned by ultm8_rls_helper (a Franchise Owner's own
-- RLS context can't see School rows at all), still capped at 1000 rows.

DROP FUNCTION IF EXISTS "schools_for_franchise"(text, text);

CREATE FUNCTION "franchise_member_schools"(p_franchise_id text)
RETURNS TABLE (
  "id" text,
  "name" text,
  "businessType" text,
  "logoUrl" text,
  "franchiseFeeSubscriptionStatus" text,
  "archivedAt" timestamp(3),
  "createdAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s."id", s."name", s."businessType", s."logoUrl",
         s."franchiseFeeSubscriptionStatus"::text, s."archivedAt", s."createdAt"
  FROM public."School" s
  WHERE s."franchiseId" = p_franchise_id
    AND EXISTS (
      SELECT 1 FROM public."RoleGrant" rg
      WHERE rg."franchiseId" = p_franchise_id
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" = 'FRANCHISE_OWNER'
        AND rg."revokedAt" IS NULL
    )
  ORDER BY s."name", s."id"
  LIMIT 1000;
$$;

ALTER FUNCTION "franchise_member_schools"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "franchise_member_schools"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "franchise_member_schools"(text) TO ultm8_app;
