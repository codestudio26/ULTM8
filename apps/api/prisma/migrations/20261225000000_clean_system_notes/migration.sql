-- Backlog 3.17: grading history notes are shown to staff and students, so they
-- no longer carry internal decision numbers. New notes are written without them;
-- this cleans the ones already saved, e.g. "Promoted in a batch; acknowledged:
-- late (Decision 130)." → "Promoted in a batch; acknowledged: late."
UPDATE "PromotionEvent"
SET "systemNote" = regexp_replace("systemNote", '\s*\((Decisions?|Spec)\M[^)]*\)', '', 'g')
WHERE "systemNote" ~ '\((Decisions?|Spec)\M';
