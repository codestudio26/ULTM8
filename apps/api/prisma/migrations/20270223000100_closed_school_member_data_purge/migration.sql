-- Stress test round 5, PRIV-1 stage 2 (Decision 433): a closed School kept
-- for its members' payment history or signed waivers (anonymized in place by
-- the tenant-lifecycle purge) also loses its members' other data. Stage 1
-- (code only) ends every role at the School and deletes the member rows the
-- jobs role could already delete. This migration lets it delete the rest:
-- broadcasts, the staff activity log, coach invites, front-desk sessions,
-- hours trained, and the bookings no money row refers to (with their guests'
-- seats, which cascade). Notifications stay: they are each person's own
-- record (Decisions 244, 277). Transactions, Memberships, Charges and signed
-- waivers stay as before (Decisions 261, 426).
--
-- Every new jobs policy below is limited to Schools already purged
-- (School.purgedAt set), like waiver_jobs_delete_purged_school
-- (20270214000000): a live or still-reopenable School's rows can't be
-- deleted by the job, whatever its code does.

-- 1. Marks a purged School whose member data is gone, so the daily sweep
--    finishes each School once and catches up the ones purged before this
--    change (purgedAt set, memberDataPurgedAt null).
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "memberDataPurgedAt" TIMESTAMP(3);
GRANT SELECT ("memberDataPurgedAt"), UPDATE ("memberDataPurgedAt") ON "School" TO ultm8_jobs;

-- 2. Broadcasts, the staff activity log, coach invites, front-desk sessions
--    and hours trained of a purged School. SELECT on the key columns is what
--    a DELETE ... WHERE "schoolId" = ... needs; its policy is limited the
--    same way, so the job reads nothing new of a live School.
GRANT SELECT ("id", "schoolId"), DELETE ON "NotificationBroadcast" TO ultm8_jobs;
GRANT SELECT ("id", "schoolId"), DELETE ON "StaffActivity" TO ultm8_jobs;
GRANT SELECT ("id", "schoolId"), DELETE ON "CoachInvite" TO ultm8_jobs;
GRANT SELECT ("id", "schoolId"), DELETE ON "FrontDeskSession" TO ultm8_jobs;
GRANT SELECT ("id", "schoolId"), DELETE ON "TrainingLog" TO ultm8_jobs;

DROP POLICY IF EXISTS "notification_broadcast_jobs_read_purged_school" ON "NotificationBroadcast";
CREATE POLICY "notification_broadcast_jobs_read_purged_school" ON "NotificationBroadcast"
  FOR SELECT TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "NotificationBroadcast"."schoolId" AND s."purgedAt" IS NOT NULL));
DROP POLICY IF EXISTS "notification_broadcast_jobs_delete_purged_school" ON "NotificationBroadcast";
CREATE POLICY "notification_broadcast_jobs_delete_purged_school" ON "NotificationBroadcast"
  FOR DELETE TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "NotificationBroadcast"."schoolId" AND s."purgedAt" IS NOT NULL));

DROP POLICY IF EXISTS "staff_activity_jobs_read_purged_school" ON "StaffActivity";
CREATE POLICY "staff_activity_jobs_read_purged_school" ON "StaffActivity"
  FOR SELECT TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "StaffActivity"."schoolId" AND s."purgedAt" IS NOT NULL));
DROP POLICY IF EXISTS "staff_activity_jobs_delete_purged_school" ON "StaffActivity";
CREATE POLICY "staff_activity_jobs_delete_purged_school" ON "StaffActivity"
  FOR DELETE TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "StaffActivity"."schoolId" AND s."purgedAt" IS NOT NULL));

-- CoachInvite, FrontDeskSession and TrainingLog already have a jobs read
-- policy (USING true); only the delete is new.
DROP POLICY IF EXISTS "coach_invite_jobs_delete_purged_school" ON "CoachInvite";
CREATE POLICY "coach_invite_jobs_delete_purged_school" ON "CoachInvite"
  FOR DELETE TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "CoachInvite"."schoolId" AND s."purgedAt" IS NOT NULL));

DROP POLICY IF EXISTS "front_desk_session_jobs_delete_purged_school" ON "FrontDeskSession";
CREATE POLICY "front_desk_session_jobs_delete_purged_school" ON "FrontDeskSession"
  FOR DELETE TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "FrontDeskSession"."schoolId" AND s."purgedAt" IS NOT NULL));

DROP POLICY IF EXISTS "training_log_jobs_delete_purged_school" ON "TrainingLog";
CREATE POLICY "training_log_jobs_delete_purged_school" ON "TrainingLog"
  FOR DELETE TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "TrainingLog"."schoolId" AND s."purgedAt" IS NOT NULL));

-- 3. Bookings of a purged School that no money row refers to: no
--    Transaction (a late-cancel fee), no fee or refund amount or Stripe id on
--    the Booking, no refund owed, pending or paid in money, and none of that
--    on any guest's seat. Those stay with the payment history. A deleted
--    Booking's guest seats (BookingAttendee) cascade; waitlist claims, hours
--    trained and guest waiver signatures pointing at it are set to null.
--    The Transaction and guest-seat checks read other tables whose own
--    policies refer back to Booking, so they run in a SECURITY DEFINER
--    function owned by ultm8_rls_helper (BYPASSRLS), the same pattern as
--    school_has_any_role_grant (20260906000000); inline, Postgres reports
--    infinite recursion in the Booking policy.
CREATE OR REPLACE FUNCTION "booking_money_row_refers"(p_booking_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public."Transaction" t WHERE t."bookingId" = p_booking_id)
      OR EXISTS (
        SELECT 1 FROM public."BookingAttendee" a
        WHERE a."bookingId" = p_booking_id
          AND (a."refundAmount" IS NOT NULL OR a."stripeRefundId" IS NOT NULL
               OR a."refundResolution" IN ('PENDING', 'MONEY_REFUNDED', 'REFUND_OWED'))
      );
$$;
GRANT SELECT ("bookingId") ON "Transaction" TO ultm8_rls_helper;
GRANT SELECT ("bookingId", "refundAmount", "stripeRefundId", "refundResolution") ON "BookingAttendee" TO ultm8_rls_helper;
ALTER FUNCTION "booking_money_row_refers"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "booking_money_row_refers"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "booking_money_row_refers"(text) TO ultm8_jobs;

GRANT DELETE ON "Booking" TO ultm8_jobs;
DROP POLICY IF EXISTS "booking_jobs_delete_purged_school" ON "Booking";
CREATE POLICY "booking_jobs_delete_purged_school" ON "Booking"
  FOR DELETE TO ultm8_jobs
  USING (
    EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "Booking"."schoolId" AND s."purgedAt" IS NOT NULL)
    AND "Booking"."cancellationChargeAmount" IS NULL
    AND "Booking"."stripeCancellationPaymentIntentId" IS NULL
    AND "Booking"."refundAmount" IS NULL
    AND "Booking"."stripeRefundId" IS NULL
    AND "Booking"."noShowFeeAmount" IS NULL
    AND "Booking"."stripeNoShowPaymentIntentId" IS NULL
    AND ("Booking"."refundResolution" IS NULL OR "Booking"."refundResolution" NOT IN ('PENDING', 'MONEY_REFUNDED', 'REFUND_OWED'))
    AND NOT "booking_money_row_refers"("Booking"."id")
  );
