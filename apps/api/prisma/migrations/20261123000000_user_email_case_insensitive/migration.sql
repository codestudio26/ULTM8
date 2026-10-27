-- Decision 295: one email, one account, whatever the capitals.
--
-- The API now lower-cases and trims every email that creates or finds a User
-- (NormalizeEmail on the register, login, Add Manually, invite-candidate and
-- coach-invite DTOs). This brings existing rows into line so their owners can
-- still sign in, then lets the database refuse a second account that differs
-- only by case.
--
-- Runs as the migration superuser (like every migration here since
-- 20260904000000), so User's FORCE ROW LEVEL SECURITY doesn't hide rows.

-- 1. Lower-case every email whose lower-case form no other account holds.
UPDATE "User" u
SET "email" = lower(btrim(u."email"))
WHERE u."email" <> lower(btrim(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "User" o
    WHERE o."id" <> u."id" AND lower(btrim(o."email")) = lower(btrim(u."email"))
  );

-- 2. Refuse case-only duplicates from now on. If any already exist (two real
-- accounts that differ only by case), they're left alone for a person to
-- merge, and the index waits: the warning names how many there are, and a
-- later migration creates it once they're resolved. The API's lower-casing
-- still stops new ones either way.
DO $$
DECLARE
  dupes integer;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM "User" GROUP BY lower("email") HAVING count(*) > 1
  ) d;
  IF dupes = 0 THEN
    CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
  ELSE
    RAISE WARNING 'Decision 295: % email(s) are held by more than one account differing only by case; "User_email_lower_key" was not created. Merge them, then add the index.', dupes;
  END IF;
END $$;
