-- Decision 434 (TXT-9): one waiting sign-up per email at a School, as
-- Decision 392 item 1 says, held by the database. SignUpsService checked
-- and then inserted with no lock, so a tablet's Send sent several times at
-- once left several PENDING rows for one email.
--
-- 1. Leftovers of the person who is now a student: a waiting row for an email
--    whose sign-up at this School was approved, and whose account is an active
--    Student there. Approving it could only say "already a student".
DELETE FROM "SignUp" w
 WHERE w."status" IN ('PENDING', 'INVITED')
   AND EXISTS (
     SELECT 1
       FROM "SignUp" a
       JOIN "RoleGrant" g ON g."userId" = a."userId" AND g."schoolId" = a."schoolId" AND g."role" = 'STUDENT' AND g."revokedAt" IS NULL
      WHERE a."schoolId" = w."schoolId"
        AND a."email" = w."email"
        AND a."status" = 'APPROVED'
   );

-- 2. Duplicates: one waiting row per (School, email) is kept, the one staff
--    already acted on (INVITED) if any, else the oldest; the younger copies go.
DELETE FROM "SignUp" d
 USING (
   SELECT "id",
          row_number() OVER (
            PARTITION BY "schoolId", "email"
            ORDER BY ("status" = 'INVITED') DESC, "createdAt" ASC, "id" ASC
          ) AS n
     FROM "SignUp"
    WHERE "status" IN ('PENDING', 'INVITED')
 ) ranked
 WHERE d."id" = ranked."id" AND ranked.n > 1;

-- 3. The rule itself. SignUpsService maps a clash to 409 SIGN_UP_WAITING.
CREATE UNIQUE INDEX IF NOT EXISTS "SignUp_one_waiting_per_email"
  ON "SignUp"("schoolId", "email")
  WHERE "status" IN ('PENDING', 'INVITED');
