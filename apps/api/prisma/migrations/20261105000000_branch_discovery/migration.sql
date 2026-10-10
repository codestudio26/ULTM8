-- Decision 209: a School's branch names are shown to anyone browsing it in the
-- app, so a student can choose their home branch when joining (Decisions 139,
-- 168 require one in a School with branches, and a non-member can't read
-- Branch under ultm8_app's RLS). Only id, schoolId and name, through the
-- dedicated discovery role, the same way School's own profile fields are
-- (Decision 94). Address, phone and the rest stay staff-only.
GRANT SELECT ("id", "schoolId", "name") ON "Branch" TO ultm8_discovery;

CREATE POLICY "branch_discovery_read" ON "Branch"
  FOR SELECT
  TO ultm8_discovery
  USING (true);
