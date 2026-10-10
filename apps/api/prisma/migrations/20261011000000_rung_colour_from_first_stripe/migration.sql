-- Decision 165: a rung's single colour follows the first entry in its stripe
-- list, so the two can never disagree. Data only, no schema change. Rows
-- written before this rule could disagree (PR 2 accepted both independently);
-- bring them into line. Rungs with no stripes keep their colour.
UPDATE "RankStripeTier"
SET "colour" = "stripeSegments" -> 0 ->> 'colour'
WHERE jsonb_typeof("stripeSegments") = 'array'
  AND jsonb_array_length("stripeSegments") > 0
  AND "stripeSegments" -> 0 ->> 'colour' IS NOT NULL
  AND "colour" IS DISTINCT FROM "stripeSegments" -> 0 ->> 'colour';
