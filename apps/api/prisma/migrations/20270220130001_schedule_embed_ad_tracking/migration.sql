-- Decision 318 item 10 (Decision 435 items 24–27): the schedule embed page
-- loads the School's saved Meta Pixel / Google Analytics IDs behind a
-- cookie-consent banner. The page has no sign-in, so it reads the two IDs the
-- same way it reads the School's name: a SECURITY DEFINER function keyed by
-- the embed link, owned by ultm8_rls_helper, returning only those two
-- columns, only while the embed is on and the School isn't archived.
--
-- A separate function (not a wider "schedule_embed") so the embed's JSON
-- answer stays exactly as it was. No table grant changes.
CREATE FUNCTION "schedule_embed_tracking"(p_key text)
RETURNS TABLE ("metaPixelId" text, "googleAnalyticsId" text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s."metaPixelId", s."googleAnalyticsId"
  FROM public."School" s
  WHERE p_key IS NOT NULL AND p_key <> '' AND s."scheduleEmbedKey" = p_key AND s."archivedAt" IS NULL;
$$;
ALTER FUNCTION "schedule_embed_tracking"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "schedule_embed_tracking"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "schedule_embed_tracking"(text) TO ultm8_app;
