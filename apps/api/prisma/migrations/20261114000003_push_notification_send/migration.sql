-- Push notification SEND (Decision 223/264). notification-fanout.processor.ts
-- needs to read a target User's DeviceToken rows to dispatch push, and delete
-- any FCM reports back as unregistered/invalid — a real second ultm8_jobs
-- consumer, exactly the gap DeviceToken's own existing RLS comment (see
-- 20260918000000_notifications_module/migration.sql) named: "Add one only
-- once a future phase actually implements push dispatch and needs to look up
-- a target's tokens." Whole-table, not column-scoped — unlike User's own
-- ultm8_jobs grant (narrowed to id/email because it carries passcodeHash and
-- other PII), DeviceToken carries nothing sensitive beyond the token string
-- itself, which push dispatch needs in full regardless.
GRANT SELECT, DELETE ON "DeviceToken" TO ultm8_jobs;

CREATE POLICY "device_token_jobs_read" ON "DeviceToken"
  FOR SELECT
  TO ultm8_jobs
  USING (true);

CREATE POLICY "device_token_jobs_delete_stale" ON "DeviceToken"
  FOR DELETE
  TO ultm8_jobs
  USING (true);
