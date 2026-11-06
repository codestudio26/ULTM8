-- Decision 442 items 2 and 3.
--
-- Item 2: a School takes card payments only once Stripe says its connected
-- account is ready (PaymentAccount.stripeAccountReady, Decision 441 item 6:
-- onboarding finished and charges enabled). Until then it behaves as a School
-- that takes no cards. The API's rule is takesCards() (src/payments/
-- takes-cards.ts); the two database functions that answer the same question
-- for the discovery connection follow it here. Same signatures, owner
-- (ultm8_rls_helper) and grants: CREATE OR REPLACE keeps them. Nothing else is
-- granted.
--   school_card_payments(): the member app's "this School takes cards"
--     (Decision 437) on the School's public profile.
--   card_surcharge_bps(): a card surcharge (Decision 406) is added only where
--     the School takes cards, so it is 0 until the account is ready.
CREATE OR REPLACE FUNCTION "school_card_payments"(p_school_id text)
RETURNS TABLE("cardPayments" boolean, "inBrazil" boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public."PaymentAccount" pa
      WHERE pa."schoolId" = s."id" AND pa."provider" = 'STRIPE'
        AND pa."stripeConnectedAccountId" IS NOT NULL AND pa."stripeAccountReady"
    ),
    upper(coalesce(s."addressCountry", '')) = 'BR'
  FROM public."School" s
  WHERE s."id" = p_school_id AND s."archivedAt" IS NULL;
$$;

CREATE OR REPLACE FUNCTION "card_surcharge_bps"(p_school_id text)
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
          AND pa."stripeConnectedAccountId" IS NOT NULL AND pa."stripeAccountReady"
      )
  ), 0);
$$;

-- Item 3: "Can connect Stripe", a Branch Staff switch the School's owners give
-- (Decision 387's Access window). Off by default; owners always can. Checked
-- by the API (TenantAuthorizationService.assertMayConnectStripe) before
-- creating the School's Stripe payment account, starting Stripe onboarding and
-- reading the connection status. StaffPermission's existing grants and
-- policies apply; PaymentAccount's tenant policy already admits anyone with a
-- role at the School, and the API narrows its writes.
ALTER TABLE "StaffPermission" ADD COLUMN "canConnectStripe" BOOLEAN NOT NULL DEFAULT false;
