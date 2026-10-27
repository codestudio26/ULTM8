-- Decision 361: a role change takes effect on the person's next request, not
-- up to 15 minutes later when their access token expires.
--
-- "rolesChangedAt" is stamped by a trigger on every insert, update or delete of
-- a RoleGrant row, so every path that gives, ends or removes a role is caught
-- (the Staff page, coach invites, Add Manually, enrolment, closing a School,
-- the purge jobs), including ones written in raw SQL. Each access token carries
-- the stamp it was built from; JwtStrategy refuses a token whose stamp is older
-- than the User's current one, and the apps quietly refresh to get a token with
-- the person's current roles.
ALTER TABLE "User" ADD COLUMN "rolesChangedAt" TIMESTAMP(3);

-- SECURITY DEFINER, owned by the BYPASSRLS helper role: the user making the
-- change (a School owner) usually can't UPDATE the other person's User row
-- under "user_self_or_shared_school". It only ever writes this one column.
CREATE FUNCTION "stamp_user_roles_changed_at"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
GRANT UPDATE ("rolesChangedAt") ON "User" TO ultm8_rls_helper;
GRANT SELECT ("id") ON "User" TO ultm8_rls_helper;

CREATE TRIGGER "RoleGrant_stamp_user_roles_changed_at"
AFTER INSERT OR UPDATE OR DELETE ON "RoleGrant"
FOR EACH ROW EXECUTE FUNCTION "stamp_user_roles_changed_at"();
