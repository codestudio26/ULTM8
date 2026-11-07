-- Decision 446 item 7 (stress test round 6, T-4): an older account.updated
-- can never overwrite a newer answer. With more than one worker, two
-- account.updated events for one connected account can be processed at once;
-- each re-reads the Account from Stripe, and the one whose read started
-- earlier could finish last and save Stripe's older answer.
--
-- "stripeAccountReadyCheckedAt" is when the saved answer was asked of Stripe
-- (the start of the read). A write carries the start of its own read and
-- changes the row only when that is later than the one saved, so the newest
-- read always wins, whatever order the writes land in. Null (never read since
-- this column was added) is older than any read.
ALTER TABLE "PaymentAccount" ADD COLUMN "stripeAccountReadyCheckedAt" TIMESTAMP(3);

DROP FUNCTION "set_stripe_account_ready"(text, boolean);

-- Same narrow SECURITY DEFINER shape as before (20270304000001): owned by the
-- BYPASSRLS helper role, writes only these columns on the row of one
-- connected account. The value always comes from Stripe's own account
-- (re-read by the processor), never from a client. p_checked_at is UTC.
-- Returns how many rows changed.
CREATE FUNCTION "set_stripe_account_ready"(p_stripe_account_id text, p_ready boolean, p_checked_at timestamp(3))
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  WITH changed AS (
    UPDATE public."PaymentAccount"
    SET "stripeAccountReady" = p_ready,
        "stripeAccountReadyCheckedAt" = p_checked_at,
        "updatedAt" = CASE WHEN "stripeAccountReady" IS DISTINCT FROM p_ready THEN clock_timestamp() ELSE "updatedAt" END
    WHERE "stripeConnectedAccountId" = p_stripe_account_id
      AND ("stripeAccountReadyCheckedAt" IS NULL OR "stripeAccountReadyCheckedAt" < p_checked_at)
    RETURNING 1
  )
  SELECT count(*)::integer FROM changed;
$$;

ALTER FUNCTION "set_stripe_account_ready"(text, boolean, timestamp) OWNER TO ultm8_rls_helper;
GRANT UPDATE ("stripeAccountReadyCheckedAt") ON "PaymentAccount" TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "set_stripe_account_ready"(text, boolean, timestamp) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "set_stripe_account_ready"(text, boolean, timestamp) TO ultm8_jobs;
