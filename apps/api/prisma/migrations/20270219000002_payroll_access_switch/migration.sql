-- Decision 435 item 22 (builds Decision 320 item 4): a "Payroll" access
-- switch for Branch Staff. Off by default and in no preset; it covers the
-- whole School (the report and the rates). Owners keep access by role.
-- StaffPermission's existing grants and policies apply to the new column.
ALTER TABLE "StaffPermission" ADD COLUMN "canSeePayroll" BOOLEAN NOT NULL DEFAULT false;

-- Whether the caller is Branch Staff at this School (an active, unpaused
-- role: a paused role has revokedAt set, Decision 390) whom the owner
-- switched on for payroll. SECURITY DEFINER, owned by the BYPASSRLS helper
-- role ultm8_rls_helper like is_active_school_owner_manager, so the check
-- never depends on the caller's own RLS view (and can't recurse into it).
-- ultm8_rls_helper already reads RoleGrant and StaffPermission.
CREATE FUNCTION public."is_payroll_staff"(p_school_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."RoleGrant"
    WHERE "userId" = current_setting('app.current_user_id', true)
      AND "schoolId" = p_school_id
      AND "role" = 'BRANCH_STAFF'
      AND "revokedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM public."StaffPermission"
    WHERE "userId" = current_setting('app.current_user_id', true)
      AND "schoolId" = p_school_id
      AND "canSeePayroll"
  )
  AND (
    current_setting('app.impersonation_school_id', true) IS NULL
    OR current_setting('app.impersonation_school_id', true) = ''
    OR current_setting('app.impersonation_school_id', true) = p_school_id
  );
$$;
ALTER FUNCTION public."is_payroll_staff"(text) OWNER TO ultm8_rls_helper;

-- The rates: the owner's policy stays; Branch Staff switched on read and
-- write them for the whole School too. Nobody else, and still no grant to
-- ultm8_jobs.
CREATE POLICY "staff_pay_rate_payroll_staff_manage" ON "StaffPayRate"
  USING (is_payroll_staff("StaffPayRate"."schoolId"))
  WITH CHECK (is_payroll_staff("StaffPayRate"."schoolId"));
