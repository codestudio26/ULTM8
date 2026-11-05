-- Decision 427 (Student portal review SP6): the app shows a class's times on
-- the class's own clock — its Branch's time zone, else the School's — rather
-- than the phone's. The School page in the app is read through the dedicated
-- discovery role (Decision 94), which could not see any time zone, nor which
-- Branch a class is at.
--
-- Narrowest change that does it: three column-level SELECT grants, no new
-- policy (School, Branch and Class already have a discovery read policy, and
-- these columns sit on rows that role can already read). A time zone name and
-- a Branch id are not personal data; Branch ids and names are already granted
-- (Decision 209). Nothing is granted to ultm8_app or ultm8_jobs.
GRANT SELECT ("timezone") ON "School" TO ultm8_discovery;
GRANT SELECT ("timezone") ON "Branch" TO ultm8_discovery;
GRANT SELECT ("branchId") ON "Class" TO ultm8_discovery;
