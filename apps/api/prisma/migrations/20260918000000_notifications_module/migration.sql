-- ULTM8 Phase 15 — NotificationsModule (in-app notifications + email delivery,
-- DeviceToken registration for a future push-dispatch phase).
--
-- See docs/decisions/POST-SPEC-55-DECISION-LOG.md, Decision 95, for the full
-- scoping reasoning. Summary: Spec 55 §6.1 confirms a minimal Notification
-- entity (title/body, read state, target user) and a DeviceToken entity
-- (Decision 46), and §11.4 confirms real delivery vendors (push: FCM/APNs
-- direct; email: Postmark primary, AWS SES fallback; SMS: Twilio Verify,
-- already built for OTP specifically). This phase builds the entities, the
-- read-side API, DeviceToken registration, and a REAL, working email delivery
-- path — push dispatch (the actual FCM/APNs send) is deliberately deferred to
-- its own phase, not built speculatively ahead of anything exercising it.

CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    -- RESTRICT, not CASCADE — matches this codebase's established audit-trail-
    -- preservation precedent (Booking, ConsentRecord) for any table with no
    -- general account-deletion pipeline yet.
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Matches NotificationsService.findAllForCaller's actual query (WHERE userId
-- AND a (createdAt, id) keyset cursor, ORDER BY createdAt DESC, id DESC) — an
-- earlier draft indexed (userId, read) and (userId, createdAt) separately,
-- neither of which the real query shape used; found on review.
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");

GRANT SELECT, UPDATE ON "Notification" TO ultm8_app;

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_self_only" ON "Notification"
  USING ("Notification"."userId" = current_setting('app.current_user_id', true));

-- ultm8_jobs: the notification-fanout job (this phase) is what actually writes
-- rows for a target OTHER than the calling context — e.g. every Student at a
-- School when a Waiver is assigned. Same cross-user-write gap Booking's
-- capacity check (Decision 89) and Guardian's consent-withdrawal cascade
-- (Decision 92) each already hit, closed the same established way. SELECT is
-- for Prisma's INSERT ... RETURNING, not an independent read — same reasoning
-- as class_jobs_select_for_returning. UPDATE is for the idempotent `upsert`
-- NotificationFanoutProcessor uses (a retried job's `ON CONFLICT DO UPDATE`
-- branch) — FOUND ON CI, on this migration's own first real run: the first
-- draft granted only INSERT+SELECT, matching the plain `.create()` an earlier
-- version of the processor used, and was never updated when the processor
-- itself moved to `upsert` for retry-safety — caught immediately by the new
-- direct-invocation e2e test's own idempotency assertion failing with
-- "permission denied for table Notification", not silently.
GRANT INSERT, SELECT, UPDATE ON "Notification" TO ultm8_jobs;
CREATE POLICY "notification_jobs_insert" ON "Notification"
  FOR INSERT
  TO ultm8_jobs
  WITH CHECK (true);
CREATE POLICY "notification_jobs_select_for_returning" ON "Notification"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
CREATE POLICY "notification_jobs_update" ON "Notification"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

-- notification-fanout needs to resolve a target User's email for delivery —
-- never granted to ultm8_jobs before now (grepped every prior migration to
-- confirm). Column-scoped to exactly (id, email) — found on review that
-- every other ultm8_jobs grant in this schema is whole-table (an accepted,
-- pre-existing architectural characteristic of that shared role, not
-- something this migration should unilaterally restructure), but User is a
-- meaningfully different case: it's the one table in this schema carrying a
-- literal login credential (passcodeHash) and a cluster of other PII
-- (phone, dateOfBirth, address) that no ultm8_jobs consumer has ever needed
-- and this one doesn't either — narrowing costs nothing here and measurably
-- shrinks what a bug in any OTHER ultm8_jobs-connected job (this role is
-- shared platform-wide, not dedicated to NotificationsModule) could expose.
GRANT SELECT ("id", "email") ON "User" TO ultm8_jobs;
CREATE POLICY "user_jobs_read" ON "User"
  FOR SELECT
  TO ultm8_jobs
  USING (true);

-- WaiverSignatureRequestsProcessor (this phase, wiring its own already-existing
-- log-only stub to real notification fan-out) needs to read the triggering
-- Waiver's own title for the notification body text — never granted to
-- ultm8_jobs before now (grepped every prior migration to confirm).
GRANT SELECT ON "Waiver" TO ultm8_jobs;
CREATE POLICY "waiver_jobs_read" ON "Waiver"
  FOR SELECT
  TO ultm8_jobs
  USING (true);

-- ============================================================================
-- FOUND ON REVIEW — documenting an implicit cross-migration dependency, not
-- fixing it here: both `user_jobs_read` and `waiver_jobs_read` above are
-- PERMISSIVE policies OR-combined with User's/Waiver's own PRE-EXISTING,
-- PUBLIC-scoped tenant_isolation policies (neither of those declares an
-- explicit `TO`, so Postgres defaults them to PUBLIC — the exact mechanism
-- Decision 94's "FOUND ON CI" section documents in full). Both of those
-- pre-existing policies do an inline `EXISTS (SELECT 1 FROM "RoleGrant" ...)`,
-- which means evaluating them for ultm8_jobs requires ultm8_jobs to hold
-- SELECT on RoleGrant — satisfied only because Phase 12's migration
-- (20260916000000_guardian_consent_module) already granted it, for a
-- completely unrelated reason (the baseline-consent-withdrawal cascade). If a
-- future migration ever narrows or revokes that grant, WaiverSignatureRequests
-- Processor's Waiver read and NotificationFanoutProcessor's User read would
-- both start failing with "permission denied for table RoleGrant" — a
-- confusing failure with no apparent connection to RoleGrant from either call
-- site. Recorded here so that failure mode is traceable if it ever recurs,
-- not rediscovered from scratch.
-- ============================================================================

CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CASCADE (not RESTRICT) is deliberate here, unlike Notification above — a
-- DeviceToken carries no audit-trail value of its own once its owning User row
-- is gone; it's routing infrastructure, not a record of something that
-- happened. Nothing else in this schema references DeviceToken by FK.
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "DeviceToken" TO ultm8_app;

ALTER TABLE "DeviceToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceToken" FORCE ROW LEVEL SECURITY;
-- Self-only, ALL commands — registration always happens under the owning
-- caller's own context, so no ultm8_jobs bypass is needed yet. Add one only
-- once a future phase actually implements push dispatch and needs to look up
-- a target's tokens (PrismaJobsService's own header comment: don't broaden a
-- grant ahead of anything actually needing it).
CREATE POLICY "device_token_self_only" ON "DeviceToken"
  USING ("DeviceToken"."userId" = current_setting('app.current_user_id', true));
