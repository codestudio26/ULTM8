-- Decision 450 item 1 — the Franchise owner's read-only overview of its member
-- Schools' totals: students, attendance, revenue and growth, per School and
-- added up across the Franchise. Only totals cross the School boundary, never
-- a member's personal details.
--
-- A Franchise owner holds no role at its member Schools, so its own RLS
-- context can't read any of their rows. Like franchise_member_schools()
-- (Decision 337, migration 20261129000000_franchise_review_fixes), these are
-- SECURITY DEFINER functions owned by ultm8_rls_helper that check the caller
-- themselves, from `app.current_user_id` (the same session setting every RLS
-- policy reads, never an argument):
--   - the caller holds an active FRANCHISE_OWNER grant on the Franchise;
--   - only Schools whose franchiseId is that Franchise now are read (a School
--     that left is out);
--   - nothing is returned during a Platform Admin impersonation session (the
--     endpoint refuses it too), the same posture as the School roster.
-- Every column they return is a count or a sum (and the School's id, name,
-- closed date and time zone, which the roster already shows the owner). No
-- student id, name, email or per-person row is ever returned.
--
-- The numbers use the same rules as each School's own reports, so the owner
-- of a member School and the Franchise owner see the same figures:
--   - students: loadActiveStudents() (Dashboard / Students → Growth):
--     enrolled = an active STUDENT grant; active = enrolled with a live
--     Subscription, Class Pack with credits, Weekly Pass or Trial
--     (isMembershipLive) that no approved freeze covers today
--     (frozenMembershipIds / isFrozenOn, Decision 422 item 5);
--   - attendance: Students → Attendance statistics (Decision 317 item 3,
--     StaffAttendanceService.stats with no filter): completed bookings plus
--     checked-in guests, of classes that started in the last 30 days up to
--     now; by month, the same count per calendar month;
--   - growth: Students → Growth: new students by join date (StudentJoinDate),
--     cancelled = students whose Subscription ended by cancellation
--     (Membership.cancelAt) up to now, each counted once a month;
--   - revenue: the billing overview (ChargeReportsService.overview,
--     keptRevenue(), Decisions 414, 446, 448 item 1, 449 item 10), per
--     currency and never added across currencies.
-- Months are the last 12 calendar months, this one included, in each School's
-- own time zone (UTC when it has none or one Postgres doesn't know), as the
-- School's reports do.

-- Column grants the functions below need beyond what ultm8_rls_helper already
-- holds (it is NOLOGIN; only the functions it owns use them).
GRANT SELECT ("membershipId", "status", "startsAt", "endsAt", "endedEarlyAt") ON "MembershipFreeze" TO ultm8_rls_helper;
GRANT SELECT ("schoolId", "kind", "status", "billingDate", "amount", "currency", "refundedAmount", "surchargeAmount", "joiningFeeAmount", "joiningFeeRefundable") ON "Transaction" TO ultm8_rls_helper;
GRANT SELECT ("schoolId", "kind", "amount", "currency", "createdAt") ON "BalanceEntry" TO ultm8_rls_helper;

-- The time zone a School's reports use: its own, or UTC when it has none
-- (safeZone()). A name Postgres doesn't know also falls back to UTC, as
-- school_local_date() does (migration 20270123000000_member_details).
CREATE FUNCTION "franchise_overview_zone"(p_zone text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_zone IS NULL OR p_zone = '' THEN
    RETURN 'UTC';
  END IF;
  PERFORM now() AT TIME ZONE p_zone;
  RETURN p_zone;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN 'UTC';
END;
$$;
ALTER FUNCTION "franchise_overview_zone"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "franchise_overview_zone"(text) FROM PUBLIC;

-- The member Schools the caller may see totals of, each with the time zone its
-- own reports use. Empty unless the caller owns the Franchise. Not granted to
-- ultm8_app: only the functions below (same owner) call it.
CREATE FUNCTION "franchise_overview_scope"(p_franchise_id text)
RETURNS TABLE ("schoolId" text, "zone" text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s."id", public."franchise_overview_zone"(s."timezone")
  FROM public."School" s
  WHERE s."franchiseId" = p_franchise_id
    AND coalesce(current_setting('app.impersonation_school_id', true), '') = ''
    AND EXISTS (
      SELECT 1 FROM public."RoleGrant" rg
      WHERE rg."franchiseId" = p_franchise_id
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" = 'FRANCHISE_OWNER'
        AND rg."revokedAt" IS NULL
    )
  ORDER BY s."id"
  LIMIT 1000;
$$;
ALTER FUNCTION "franchise_overview_scope"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "franchise_overview_scope"(text) FROM PUBLIC;

-- One row per member School: who it is (as the roster shows it), enrolled and
-- active students now, and check-ins over the last 30 days.
CREATE FUNCTION "franchise_overview_school_totals"(p_franchise_id text)
RETURNS TABLE (
  "schoolId" text,
  "name" text,
  "archivedAt" timestamp(3),
  "timeZone" text,
  "enrolledStudents" integer,
  "activeStudents" integer,
  "checkInsLast30Days" integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT sc."schoolId", sc."zone",
           (now() AT TIME ZONE sc."zone")::date AS today,
           (((now() AT TIME ZONE sc."zone")::date - 29)::timestamp AT TIME ZONE sc."zone") AT TIME ZONE 'UTC' AS from_ts
    FROM public."franchise_overview_scope"(p_franchise_id) sc
  ),
  enrolled AS (
    SELECT DISTINCT rg."schoolId", rg."userId"
    FROM scope sc
    JOIN public."RoleGrant" rg ON rg."schoolId" = sc."schoolId" AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
  ),
  active AS (
    SELECT DISTINCT e."schoolId", e."userId"
    FROM enrolled e
    JOIN scope sc ON sc."schoolId" = e."schoolId"
    JOIN public."Membership" m ON m."schoolId" = e."schoolId" AND m."studentId" = e."userId"
    JOIN public."MembershipPlan" p ON p."id" = m."membershipPlanId"
    WHERE m."status" = 'ACTIVE'
      AND p."type" IN ('SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP')
      AND (m."expiryDate" IS NULL OR m."expiryDate" >= (now() AT TIME ZONE 'UTC'))
      AND (m."classesRemaining" IS NULL OR m."classesRemaining" > 0)
      AND NOT EXISTS (
        SELECT 1 FROM public."MembershipFreeze" f
        WHERE f."membershipId" = m."id"
          AND f."status" = 'APPROVED'
          AND f."startsAt" <= sc.today
          AND sc.today < CASE
            WHEN f."endedEarlyAt" IS NULL THEN f."endsAt"
            ELSE LEAST(f."endsAt", GREATEST(f."startsAt", ((f."endedEarlyAt" AT TIME ZONE 'UTC') AT TIME ZONE sc."zone")::date))
          END
      )
  )
  SELECT s."id", s."name", s."archivedAt", sc."zone",
         (SELECT count(*) FROM enrolled e WHERE e."schoolId" = sc."schoolId")::integer,
         (SELECT count(*) FROM active a WHERE a."schoolId" = sc."schoolId")::integer,
         ((SELECT count(*) FROM public."Booking" b JOIN public."Class" c ON c."id" = b."classId"
           WHERE b."schoolId" = sc."schoolId" AND b."status" = 'COMPLETED'
             AND c."startDate" >= sc.from_ts AND c."startDate" <= (now() AT TIME ZONE 'UTC'))
          + (SELECT count(*) FROM public."BookingAttendee" ba
             JOIN public."Booking" b ON b."id" = ba."bookingId"
             JOIN public."Class" c ON c."id" = b."classId"
             WHERE ba."schoolId" = sc."schoolId" AND ba."checkedInAt" IS NOT NULL AND b."status" = 'COMPLETED'
               AND c."startDate" >= sc.from_ts AND c."startDate" <= (now() AT TIME ZONE 'UTC')))::integer
  FROM scope sc
  JOIN public."School" s ON s."id" = sc."schoolId"
  ORDER BY s."name", s."id";
$$;
ALTER FUNCTION "franchise_overview_school_totals"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "franchise_overview_school_totals"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "franchise_overview_school_totals"(text) TO ultm8_app;

-- One row per member School and month (the last 12, in the School's time
-- zone, oldest first): check-ins, new students and cancelled students.
CREATE FUNCTION "franchise_overview_school_months"(p_franchise_id text)
RETURNS TABLE (
  "schoolId" text,
  "month" text,
  "checkIns" integer,
  "newStudents" integer,
  "cancelled" integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT sc."schoolId", sc."zone",
           date_trunc('month', now() AT TIME ZONE sc."zone") - interval '11 months' AS first_local
    FROM public."franchise_overview_scope"(p_franchise_id) sc
  ),
  windows AS (
    SELECT sc."schoolId", sc."zone", sc.first_local::date AS first_day,
           (sc.first_local AT TIME ZONE sc."zone") AT TIME ZONE 'UTC' AS from_ts
    FROM scope sc
  ),
  months AS (
    SELECT sc."schoolId", i, to_char(sc.first_local + make_interval(months => i), 'YYYY-MM') AS month
    FROM scope sc CROSS JOIN generate_series(0, 11) AS i
  ),
  check_ins AS (
    SELECT w."schoolId", to_char((c."startDate" AT TIME ZONE 'UTC') AT TIME ZONE w."zone", 'YYYY-MM') AS month, count(*) AS n
    FROM windows w
    JOIN public."Booking" b ON b."schoolId" = w."schoolId" AND b."status" = 'COMPLETED'
    JOIN public."Class" c ON c."id" = b."classId" AND c."startDate" >= w.from_ts AND c."startDate" <= (now() AT TIME ZONE 'UTC')
    GROUP BY 1, 2
    UNION ALL
    SELECT w."schoolId", to_char((c."startDate" AT TIME ZONE 'UTC') AT TIME ZONE w."zone", 'YYYY-MM'), count(*)
    FROM windows w
    JOIN public."BookingAttendee" ba ON ba."schoolId" = w."schoolId" AND ba."checkedInAt" IS NOT NULL
    JOIN public."Booking" b ON b."id" = ba."bookingId" AND b."status" = 'COMPLETED'
    JOIN public."Class" c ON c."id" = b."classId" AND c."startDate" >= w.from_ts AND c."startDate" <= (now() AT TIME ZONE 'UTC')
    GROUP BY 1, 2
  ),
  joins AS (
    SELECT w."schoolId", to_char(j."joinedOn", 'YYYY-MM') AS month, count(*) AS n
    FROM windows w
    JOIN public."StudentJoinDate" j ON j."schoolId" = w."schoolId" AND j."joinedOn" >= w.first_day
    GROUP BY 1, 2
  ),
  cancellations AS (
    SELECT w."schoolId", to_char((m."cancelAt" AT TIME ZONE 'UTC') AT TIME ZONE w."zone", 'YYYY-MM') AS month,
           count(DISTINCT m."studentId") AS n
    FROM windows w
    JOIN public."Membership" m ON m."schoolId" = w."schoolId" AND m."cancelAt" >= w.from_ts AND m."cancelAt" <= (now() AT TIME ZONE 'UTC')
    JOIN public."MembershipPlan" p ON p."id" = m."membershipPlanId" AND p."type" = 'SUBSCRIPTION'
    GROUP BY 1, 2
  )
  SELECT mo."schoolId", mo.month,
         coalesce((SELECT sum(ci.n) FROM check_ins ci WHERE ci."schoolId" = mo."schoolId" AND ci.month = mo.month), 0)::integer,
         coalesce((SELECT j.n FROM joins j WHERE j."schoolId" = mo."schoolId" AND j.month = mo.month), 0)::integer,
         coalesce((SELECT ca.n FROM cancellations ca WHERE ca."schoolId" = mo."schoolId" AND ca.month = mo.month), 0)::integer
  FROM months mo
  ORDER BY mo."schoolId", mo.i;
$$;
ALTER FUNCTION "franchise_overview_school_months"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "franchise_overview_school_months"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "franchise_overview_school_months"(text) TO ultm8_app;

-- One row per member School, month and currency with revenue in it: the
-- billing overview's lines. `charges` is what was paid toward charges less
-- money given back (the ledger's PAYMENT and REFUND entries); `memberships`
-- and `fees` are the price the School kept of each payment, `surcharges` the
-- card surcharge it kept (keptRevenue()). Currency as the billing overview
-- groups it (a payment row's currency in capitals; the ledger's as stored).
CREATE FUNCTION "franchise_overview_school_revenue"(p_franchise_id text)
RETURNS TABLE (
  "schoolId" text,
  "month" text,
  "currency" text,
  "charges" bigint,
  "memberships" bigint,
  "fees" bigint,
  "surcharges" bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT sc."schoolId", sc."zone",
           date_trunc('month', now() AT TIME ZONE sc."zone") - interval '11 months' AS first_local
    FROM public."franchise_overview_scope"(p_franchise_id) sc
  ),
  windows AS (
    SELECT sc."schoolId", sc."zone", (sc.first_local AT TIME ZONE sc."zone") AT TIME ZONE 'UTC' AS from_ts,
           ARRAY(SELECT to_char(sc.first_local + make_interval(months => i), 'YYYY-MM') FROM generate_series(0, 11) AS i) AS months
    FROM scope sc
  ),
  ledger AS (
    SELECT w."schoolId", w.months,
           to_char((e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE w."zone", 'YYYY-MM') AS month,
           e."currency" AS currency,
           (-e."amount")::bigint AS charges, 0::bigint AS memberships, 0::bigint AS fees, 0::bigint AS surcharges
    FROM windows w
    JOIN public."BalanceEntry" e ON e."schoolId" = w."schoolId" AND e."kind" IN ('PAYMENT', 'REFUND') AND e."createdAt" >= w.from_ts
  ),
  payments AS (
    SELECT w."schoolId", w.months,
           to_char((t."billingDate" AT TIME ZONE 'UTC') AT TIME ZONE w."zone", 'YYYY-MM') AS month,
           upper(t."currency") AS currency,
           t."kind"::text AS kind,
           k.price, k.surcharge
    FROM windows w
    JOIN public."Transaction" t ON t."schoolId" = w."schoolId"
      AND (t."kind" IN ('MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE', 'FREEZE_FEE', 'NO_SHOW_FEE')
           OR (t."kind" = 'CHARGE_PAYMENT' AND t."surchargeAmount" > 0))
      AND t."status" IN ('SUCCESSFUL', 'REFUNDED')
      AND t."billingDate" >= w.from_ts
      AND t."currency" IS NOT NULL
    -- keptRevenue(): a refund gives back the refundable part of the price
    -- first, then the surcharge, then a non-refundable joining fee.
    CROSS JOIN LATERAL (
      SELECT GREATEST(0, coalesce(t."refundedAmount", 0))::bigint AS refunded,
             LEAST(t."amount", CASE WHEN t."joiningFeeRefundable" THEN 0 ELSE t."joiningFeeAmount" END)::bigint AS fixed_fee
    ) r
    CROSS JOIN LATERAL (SELECT LEAST(r.refunded, t."amount" - r.fixed_fee) AS from_price) p1
    CROSS JOIN LATERAL (SELECT LEAST(r.refunded - p1.from_price, t."surchargeAmount") AS from_surcharge) p2
    CROSS JOIN LATERAL (SELECT LEAST(r.refunded - p1.from_price - p2.from_surcharge, r.fixed_fee) AS from_fee) p3
    CROSS JOIN LATERAL (
      SELECT (t."amount" - p1.from_price - p3.from_fee)::bigint AS price,
             (t."surchargeAmount" - p2.from_surcharge)::bigint AS surcharge
    ) k
  ),
  lines AS (
    SELECT "schoolId", months, month, currency, charges, memberships, fees, surcharges FROM ledger
    UNION ALL
    SELECT "schoolId", months, month, currency,
           0::bigint,
           CASE WHEN kind IN ('MEMBERSHIP', 'RENEWAL') THEN price ELSE 0 END,
           CASE WHEN kind IN ('LATE_CANCEL_FEE', 'FREEZE_FEE', 'NO_SHOW_FEE') THEN price ELSE 0 END,
           surcharge
    FROM payments
  )
  SELECT l."schoolId", l.month, l.currency,
         sum(l.charges)::bigint, sum(l.memberships)::bigint, sum(l.fees)::bigint, sum(l.surcharges)::bigint
  FROM lines l
  WHERE l.month = ANY (l.months)
  GROUP BY l."schoolId", l.month, l.currency
  ORDER BY l."schoolId", l.currency, l.month;
$$;
ALTER FUNCTION "franchise_overview_school_revenue"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "franchise_overview_school_revenue"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "franchise_overview_school_revenue"(text) TO ultm8_app;
