-- Decision 370: each School has one main owner. Every other owner is a
-- co-owner. Nobody in the School can remove the main owner; the main owner can
-- hand the role to a co-owner after a passcode check, and ULTM8 support (a
-- Platform Admin) can move it.
ALTER TABLE "RoleGrant" ADD COLUMN "isMainOwner" BOOLEAN NOT NULL DEFAULT false;

-- Which owner is the main one doesn't change what anyone can do, and access
-- tokens don't carry it, so flipping only this flag must not force everyone's
-- token to refresh (Decision 361's trigger). Same function as before, plus the
-- early return when nothing but the flag (and Prisma's updatedAt) changed.
CREATE OR REPLACE FUNCTION "stamp_user_roles_changed_at"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'isMainOwner' - 'updatedAt') = (to_jsonb(OLD) - 'isMainOwner' - 'updatedAt') THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public."User" SET "rolesChangedAt" = clock_timestamp() WHERE "id" = OLD."userId";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
    UPDATE public."User" SET "rolesChangedAt" = clock_timestamp() WHERE "id" = NEW."userId";
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION "stamp_user_roles_changed_at"() OWNER TO ultm8_rls_helper;

CREATE UNIQUE INDEX "RoleGrant_one_main_owner_per_school"
  ON "RoleGrant"("schoolId")
  WHERE "isMainOwner" AND "revokedAt" IS NULL;

-- Existing Schools: the earliest live owner grant is the main owner (the
-- product owner's rule).
UPDATE "RoleGrant" rg
SET "isMainOwner" = true
FROM (
  SELECT DISTINCT ON ("schoolId") "id"
  FROM "RoleGrant"
  WHERE "role" = 'SCHOOL_OWNER_MANAGER' AND "schoolId" IS NOT NULL AND "revokedAt" IS NULL
  ORDER BY "schoolId", "grantedAt", "id"
) first_owner
WHERE rg."id" = first_owner."id";
