-- Decision 437 (Choices on #496, item 5): the member app tells members at a
-- School without card payments to pay by cash or bank transfer (Pix in
-- Brazil) at the School, where staff confirm it.
--
-- The School's public profile is read on the discovery connection, which can
-- see neither the School's payment account nor its address. Same pattern as
-- card_surcharge_bps (20270105000000): a narrow SECURITY DEFINER function
-- owned by ultm8_rls_helper, returning two booleans about one open School and
-- nothing else.
--   "cardPayments": the School has a Stripe payment account, the same test
--     the purchase uses to offer hosted Checkout and saved cards.
--   "inBrazil":     the School's address country is Brazil (for "Pix").
CREATE FUNCTION "school_card_payments"(p_school_id text)
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
    ),
    upper(coalesce(s."addressCountry", '')) = 'BR'
  FROM public."School" s
  WHERE s."id" = p_school_id AND s."archivedAt" IS NULL;
$$;

ALTER FUNCTION "school_card_payments"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "school_card_payments"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "school_card_payments"(text) TO ultm8_discovery;
