-- One-off, read-only audit (Decision 431, stress test round 5 MON-5 and MON-3).
--
-- Before Decision 431, a late-cancellation fee was charged in US dollars when
-- the plan the Booking used had no currency of its own, and a no-show fee in
-- the plan's currency, else US dollars, instead of the School's currency. This
-- lists the money rows that may have been charged in the wrong currency, plus
-- zero-decimal rows holding fractions of a unit (¥999.50), so the owner can
-- review them and refund by hand. It changes nothing: money rows are never
-- rewritten silently.
--
-- Run as the database owner (it reads across Schools):
--   psql "$DATABASE_URL" -f apps/api/scripts/audit/wrong-currency-fees.sql

\echo '1. LATE_CANCEL_FEE rows whose currency is not the plan''s currency, else the School''s'
SELECT t.id AS transaction_id, t."schoolId", s.name AS school, t."createdAt", t.amount, t.currency AS charged_in,
       COALESCE(p.currency, s."defaultCurrency") AS should_be, t.status, t."stripePaymentIntentId"
FROM "Transaction" t
JOIN "School" s ON s.id = t."schoolId"
LEFT JOIN "Booking" b ON b.id = t."bookingId"
LEFT JOIN "Membership" m ON m.id = b."sourceMembershipId"
LEFT JOIN "MembershipPlan" p ON p.id = m."membershipPlanId"
WHERE t.kind = 'LATE_CANCEL_FEE'
  AND COALESCE(p.currency, s."defaultCurrency") IS NOT NULL
  AND upper(t.currency) <> upper(COALESCE(p.currency, s."defaultCurrency"))
ORDER BY t."createdAt";

\echo '2. No-show fees charged where the old rule (plan currency, else USD) differs from the School''s currency'
SELECT b.id AS booking_id, b."schoolId", s.name AS school, b."noShowFeeAmount", COALESCE(upper(p.currency), 'USD') AS charged_in,
       upper(s."defaultCurrency") AS should_be, b."stripeNoShowPaymentIntentId"
FROM "Booking" b
JOIN "School" s ON s.id = b."schoolId"
LEFT JOIN "Membership" m ON m.id = b."sourceMembershipId"
LEFT JOIN "MembershipPlan" p ON p.id = m."membershipPlanId"
WHERE b."noShowFeeOutcome" = 'CHARGED'
  AND s."defaultCurrency" IS NOT NULL
  AND COALESCE(upper(p.currency), 'USD') <> upper(s."defaultCurrency")
ORDER BY b."updatedAt";

\echo '3. Zero-decimal currency amounts with a fraction of a unit (amount % 100 <> 0)'
WITH zero_decimal(code) AS (
  VALUES ('BIF'), ('CLP'), ('DJF'), ('GNF'), ('JPY'), ('KMF'), ('KRW'), ('MGA'), ('PYG'), ('RWF'), ('UGX'), ('VND'), ('VUV'), ('XAF'), ('XOF'), ('XPF'), ('ISK')
)
SELECT 'MembershipPlan' AS source, p.id, p."schoolId", p.price AS amount, p.currency FROM "MembershipPlan" p
  JOIN "School" s ON s.id = p."schoolId"
  WHERE upper(COALESCE(p.currency, s."defaultCurrency")) IN (SELECT code FROM zero_decimal) AND p.price % 100 <> 0
UNION ALL
SELECT 'Transaction', t.id, t."schoolId", t.amount, t.currency FROM "Transaction" t
  WHERE upper(t.currency) IN (SELECT code FROM zero_decimal) AND t.amount % 100 <> 0
UNION ALL
SELECT 'Charge', c.id, c."schoolId", c."grossAmount", c.currency FROM "Charge" c
  WHERE upper(c.currency) IN (SELECT code FROM zero_decimal) AND (c."grossAmount" % 100 <> 0 OR c."taxAmount" % 100 <> 0)
ORDER BY 1, 3;
