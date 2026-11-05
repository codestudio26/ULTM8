-- Decision 430 (stress test round 5, MON-6 steps 1 and 2): named tax lines,
-- a Branch override, and the tax included in membership receipts.
--
-- 1. Up to two named tax lines per School (Canada's GST + PST/QST; Japan's
--    and the UAE's one named line). Line 1 is the School's existing rate and
--    tax ID (Decision 411, Decision 338 item 6), now with an optional name;
--    line 2 is new: a name, a rate and its own registration number. A rate
--    of 0 on line 2 means there is no second line. Each line's rate is 0 to
--    100%, and the two together at most 100% (checked by the API).
-- 2. A Branch may override the School's tax lines (taxOverride, off by
--    default): a Montréal Branch taxed at GST + QST while the School's
--    Vancouver Branch keeps GST + PST. Whether prices include tax and the tax
--    country stay School-wide. A member's charges use the tax of their home
--    Branch when it overrides, else the School's.
-- 3. Charge.taxLines keeps each line of a charge as it was worked out
--    (name, rate, registration number, amount), beside the existing totals
--    (taxRateBasisPoints is the lines' combined rate, taxAmount their sum).
--    Null for a charge made before this, which shows its one rate as before.
-- 4. Transaction.taxSnapshot: for a membership sale or renewal, the tax
--    settings that applied when the row was written (whether prices include
--    tax, and the lines), so its receipt can show the tax it included even
--    after the School changes its rate. Filled by a trigger on insert, so
--    every path that records a membership payment (app, desk, Stripe
--    webhooks, renewals) gets it without each one having to. Membership
--    prices are not taxed on top (MON-6 step 3 is in the v1.3 backlog), so a
--    receipt only shows tax when the School's prices include tax.
--
-- Safe on a live database: new nullable or defaulted columns only, and a
-- trigger that only fills a new column. Existing rows are not backfilled
-- (their tax settings at the time are not known).

ALTER TABLE "School"
  ADD COLUMN IF NOT EXISTS "taxName" TEXT,
  ADD COLUMN IF NOT EXISTS "tax2Name" TEXT,
  ADD COLUMN IF NOT EXISTS "tax2RateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax2Id" TEXT;

ALTER TABLE "Branch"
  ADD COLUMN IF NOT EXISTS "taxOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "taxName" TEXT,
  ADD COLUMN IF NOT EXISTS "taxRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxId" TEXT,
  ADD COLUMN IF NOT EXISTS "tax2Name" TEXT,
  ADD COLUMN IF NOT EXISTS "tax2RateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax2Id" TEXT;

ALTER TABLE "Charge" ADD COLUMN IF NOT EXISTS "taxLines" JSONB;

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "taxSnapshot" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'School_tax2_rate_range') THEN
    ALTER TABLE "School" ADD CONSTRAINT "School_tax2_rate_range" CHECK ("tax2RateBasisPoints" BETWEEN 0 AND 10000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Branch_tax_rate_range') THEN
    ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tax_rate_range" CHECK ("taxRateBasisPoints" BETWEEN 0 AND 10000 AND "tax2RateBasisPoints" BETWEEN 0 AND 10000);
  END IF;
END $$;

-- The tax lines that apply to a member at a School: their home Branch's when
-- it overrides, else the School's. As JSON: {"inclusive": bool, "lines":
-- [{"name", "rateBasisPoints", "taxId"}]}, lines with a rate above 0 only.
-- The same rule as loadEffectiveTax() in apps/api/src/charges/tax-lines.ts.
CREATE OR REPLACE FUNCTION "effective_tax_snapshot"(p_school_id text, p_student_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH src AS (
    SELECT
      s."taxInclusive" AS inclusive,
      CASE WHEN b."taxOverride" THEN b."taxName" ELSE s."taxName" END AS n1,
      CASE WHEN b."taxOverride" THEN b."taxRateBasisPoints" ELSE s."taxRateBasisPoints" END AS r1,
      CASE WHEN b."taxOverride" THEN b."taxId" ELSE s."taxId" END AS id1,
      CASE WHEN b."taxOverride" THEN b."tax2Name" ELSE s."tax2Name" END AS n2,
      CASE WHEN b."taxOverride" THEN b."tax2RateBasisPoints" ELSE s."tax2RateBasisPoints" END AS r2,
      CASE WHEN b."taxOverride" THEN b."tax2Id" ELSE s."tax2Id" END AS id2,
      CASE WHEN b."taxOverride" THEN b."id" ELSE NULL END AS branch_id
    FROM public."School" s
    LEFT JOIN public."StudentHomeBranch" h ON h."schoolId" = s."id" AND h."studentId" = p_student_id
    LEFT JOIN public."Branch" b ON b."id" = h."branchId" AND b."schoolId" = s."id"
    WHERE s."id" = p_school_id
  )
  SELECT pg_catalog.jsonb_build_object(
    'inclusive', src.inclusive,
    'branchId', src.branch_id,
    'lines', (
      SELECT COALESCE(pg_catalog.jsonb_agg(l.line ORDER BY l.pos), '[]'::jsonb)
      FROM (
        SELECT 1 AS pos, pg_catalog.jsonb_build_object('name', src.n1, 'rateBasisPoints', src.r1, 'taxId', src.id1) AS line WHERE src.r1 > 0
        UNION ALL
        SELECT 2, pg_catalog.jsonb_build_object('name', src.n2, 'rateBasisPoints', src.r2, 'taxId', src.id2) WHERE src.r2 > 0
      ) l
    )
  )
  FROM src;
$$;

GRANT SELECT ON "School", "Branch", "StudentHomeBranch" TO ultm8_rls_helper;
ALTER FUNCTION "effective_tax_snapshot"(text, text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "effective_tax_snapshot"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "effective_tax_snapshot"(text, text) TO ultm8_app, ultm8_jobs;

CREATE OR REPLACE FUNCTION "transaction_tax_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."kind" IN ('MEMBERSHIP', 'RENEWAL') AND NEW."taxSnapshot" IS NULL THEN
    NEW."taxSnapshot" := public."effective_tax_snapshot"(NEW."schoolId", NEW."studentId");
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION "transaction_tax_snapshot"() OWNER TO ultm8_rls_helper;

DROP TRIGGER IF EXISTS "Transaction_tax_snapshot" ON "Transaction";
CREATE TRIGGER "Transaction_tax_snapshot"
BEFORE INSERT ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION "transaction_tax_snapshot"();
