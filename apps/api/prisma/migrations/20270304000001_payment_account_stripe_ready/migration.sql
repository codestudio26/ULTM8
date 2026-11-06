-- Decision 441 item 6: the setup checklist ticks "Connect Stripe" only once
-- Stripe confirms the School's connected account is ready (onboarding
-- finished and it can take charges), not as soon as onboarding starts.
--
-- Existing rows start false: an account already connected is ticked again the
-- next time Stripe sends account.updated for it, or when its owner opens the
-- Stripe card on the School page (which reads Stripe live and saves it).
ALTER TABLE "PaymentAccount" ADD COLUMN "stripeAccountReady" BOOLEAN NOT NULL DEFAULT false;

-- The account.updated webhook runs on ultm8_jobs, which can only read
-- PaymentAccount (payment_account_jobs_read). Rather than give it UPDATE and
-- an update policy on the whole table, a narrow SECURITY DEFINER function owned
-- by the BYPASSRLS helper role writes this one flag (and updatedAt) on the row
-- of one connected account, and nothing else. The value always comes from
-- Stripe's own account (re-read by the processor), never from a client.
-- Returns how many rows changed.
CREATE FUNCTION "set_stripe_account_ready"(p_stripe_account_id text, p_ready boolean)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public."PaymentAccount"
    SET "stripeAccountReady" = p_ready, "updatedAt" = clock_timestamp()
    WHERE "stripeConnectedAccountId" = p_stripe_account_id
      AND "stripeAccountReady" IS DISTINCT FROM p_ready
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;

ALTER FUNCTION "set_stripe_account_ready"(text, boolean) OWNER TO ultm8_rls_helper;
GRANT UPDATE ("stripeAccountReady", "updatedAt") ON "PaymentAccount" TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "set_stripe_account_ready"(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "set_stripe_account_ready"(text, boolean) TO ultm8_jobs;
