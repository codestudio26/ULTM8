-- Decision 446 item 8 (stress test round 6, T-1): for someone who signed up
-- themselves, a School counts their 18th birthday from the moment sign-up
-- does (the earliest time zone, Decision 444 item 6). The waiver-renewal
-- sweep (ultm8_jobs) needs to know who that is, to not ask them to sign again
-- "at 18" for a waiver they signed themselves as an adult on that day.
--
-- Sign-up records the Terms acceptance with no School or Franchise; no other
-- path does. LegalAcceptance stays self-only (legal_acceptance_self_only)
-- and ultm8_jobs gets no access to it: this narrow SECURITY DEFINER function,
-- owned by the BYPASSRLS helper role, answers only which of the given user
-- ids signed up themselves, and nothing else about the rows.
CREATE FUNCTION "self_signed_up_users"(p_user_ids text[])
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT la."userId"
  FROM public."LegalAcceptance" la
  WHERE la."userId" = ANY (p_user_ids)
    AND la."documentSlug" = 'terms-and-conditions'
    AND la."schoolId" IS NULL
    AND la."franchiseId" IS NULL;
$$;

ALTER FUNCTION "self_signed_up_users"(text[]) OWNER TO ultm8_rls_helper;
GRANT SELECT ("userId", "documentSlug", "schoolId", "franchiseId") ON "LegalAcceptance" TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "self_signed_up_users"(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "self_signed_up_users"(text[]) TO ultm8_jobs;
