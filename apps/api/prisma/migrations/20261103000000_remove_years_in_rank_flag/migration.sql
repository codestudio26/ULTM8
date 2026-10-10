-- Decision 200: the belt-level "years in rank" flag is removed. Each rung has
-- its own "time in rank only" switch with the years stored as minimum days
-- (Decision 128, item 3), and grading reads only that, so no student's
-- requirements change.
ALTER TABLE "Rank" DROP COLUMN "yearsInRankFlag";
