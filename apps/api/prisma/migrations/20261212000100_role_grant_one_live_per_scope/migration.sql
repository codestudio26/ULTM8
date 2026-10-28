-- One live grant per person, role and scope (stress test round 3).
--
-- Every path that creates an INSTRUCTOR/BRANCH_STAFF/SCHOOL_OWNER_MANAGER
-- grant checked for an identical live grant and then inserted in a separate
-- step, with nothing in the database behind the check. A double click on
-- "Give role" (10 parallel POST /users/:id/role-grants in the stress run) made
-- 3–10 identical live BRANCH_STAFF grants; revoking one left the person with
-- the access the owner had just removed. Same "atomic constraint over
-- app-layer check" approach as RoleGrant_one_active_student_per_school, which
-- this does not replace (a Student is one per School whatever the branch;
-- this one is per exact scope, so different branches, different Schools and
-- co-owners — different users — are all still allowed).
--
-- Live duplicates already in the database are revoked first, or the index
-- could not be built: in each group the oldest grant is kept and the others
-- get revokedAt = now(). The person keeps the same access (the kept grant is
-- identical), and the revoke stamps their rolesChangedAt through the existing
-- trigger, so their next token is rebuilt from the grants that remain.
-- franchiseId/schoolId/branchId are TEXT and nullable: COALESCE to '' so two
-- NULLs count as the same scope.
UPDATE "RoleGrant" rg
SET "revokedAt" = now(), "updatedAt" = now()
FROM (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "userId", "role", COALESCE("franchiseId", ''), COALESCE("schoolId", ''), COALESCE("branchId", '')
           ORDER BY "grantedAt", "createdAt", "id"
         ) AS n
  FROM "RoleGrant"
  WHERE "revokedAt" IS NULL
) d
WHERE rg."id" = d."id" AND d.n > 1;

CREATE UNIQUE INDEX "RoleGrant_one_live_per_scope" ON "RoleGrant" (
  "userId", "role", COALESCE("franchiseId", ''), COALESCE("schoolId", ''), COALESCE("branchId", '')
) WHERE "revokedAt" IS NULL;
