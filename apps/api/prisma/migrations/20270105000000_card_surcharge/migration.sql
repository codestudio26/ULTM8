-- Backlog 3.8, Decision 406: a card surcharge on members' card payments.
--
-- Off everywhere by default. Platform Admin keeps the list of countries where
-- a surcharge is allowed (it starts empty: a country is added only after legal
-- review). Where the School's country is on the list, the owner sets a % up to
-- 3% and confirms it is legal where the School operates. It is charged on top
-- of one-off card payments only, and kept as its own amount on Transaction.

-- 1. The allow-list. Global platform content with no tenant column, so no RLS,
--    like SubscriptionPlan/Translation. Unlike those, the tenant connection
--    only reads it: adding and removing is Platform Admin's own connection.
CREATE TABLE "CardSurchargeCountry" (
    "countryCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardSurchargeCountry_pkey" PRIMARY KEY ("countryCode"),
    CONSTRAINT "CardSurchargeCountry_code_check" CHECK ("countryCode" ~ '^[A-Z]{2}$')
);

GRANT SELECT ON "CardSurchargeCountry" TO ultm8_app;
GRANT SELECT, INSERT, DELETE ON "CardSurchargeCountry" TO ultm8_platform_admin;

-- 2. The School's own setting. ultm8_app already has table-wide School
--    grants, under School's existing RLS (owner-only writes are checked in
--    CardSurchargeService, as for every other School setting).
ALTER TABLE "School" ADD COLUMN "cardSurchargeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "cardSurchargeBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "School" ADD COLUMN "cardSurchargeConfirmedAt" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "cardSurchargeConfirmedById" TEXT;
ALTER TABLE "School" ADD CONSTRAINT "School_cardSurchargeBps_check" CHECK ("cardSurchargeBps" BETWEEN 0 AND 300);

-- 3. The surcharge charged on a payment, apart from the plan's own amount.
ALTER TABLE "Transaction" ADD COLUMN "surchargeAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_surchargeAmount_check" CHECK ("surchargeAmount" >= 0);

-- 4. The surcharge rate that applies to a School's card payments right now,
--    in basis points (0 = none): switched on, the School's country on the
--    list, an open School, and a Stripe payment account. One rule for every
--    reader: the purchase (under the payer's context, which may be a
--    Guardian's child) and the School's public profile on the discovery
--    connection, which can see neither the School's address nor its payment
--    account. It returns one number about one School, nothing else.
CREATE FUNCTION "card_surcharge_bps"(p_school_id text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT s."cardSurchargeBps"
    FROM public."School" s
    JOIN public."CardSurchargeCountry" c ON c."countryCode" = upper(s."addressCountry")
    WHERE s."id" = p_school_id
      AND s."cardSurchargeEnabled"
      AND s."cardSurchargeBps" > 0
      AND s."archivedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM public."PaymentAccount" pa
        WHERE pa."schoolId" = s."id" AND pa."provider" = 'STRIPE'
      )
  ), 0);
$$;

GRANT SELECT ON "CardSurchargeCountry" TO ultm8_rls_helper;
GRANT SELECT ON "PaymentAccount" TO ultm8_rls_helper;
ALTER FUNCTION "card_surcharge_bps"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "card_surcharge_bps"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "card_surcharge_bps"(text) TO ultm8_app, ultm8_discovery, ultm8_jobs;
