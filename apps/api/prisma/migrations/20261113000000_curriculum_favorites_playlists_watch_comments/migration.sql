-- Decision 227/254 (POST-SPEC-55-DECISION-LOG.md) — Curriculum learner-facing
-- redesign: Favorite, WatchHistory, Playlist/PlaylistItem, Comment. Category
-- is NOT a new entity here — LessonCategory already exists (Decisions 128.15,
-- 191) and is reused as-is. Video/caption integration itself needs no schema
-- change either — Lesson.captionStatus and LessonContent.videoRef/
-- captionTrackRef already exist (Decision 58/101), just unwired until this
-- same build's CloudflareStreamService/TranscribeService start writing them.
--
-- Hand-authored, not `prisma migrate dev`-generated (this repo's established
-- convention) — unverified against real Postgres until this phase's own
-- verification step runs it.

-- ============================================================================
-- 1. Favorite — self-only, same RLS shape as DeviceToken
--    (20260918000000_notifications_module). No ultm8_jobs grant: nothing
--    writes a Favorite for anyone but the caller.
-- ============================================================================

CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Favorite_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Favorite_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Favorite_studentId_lessonId_key" ON "Favorite"("studentId", "lessonId");
CREATE INDEX "Favorite_studentId_createdAt_id_idx" ON "Favorite"("studentId", "createdAt", "id");
CREATE INDEX "Favorite_schoolId_idx" ON "Favorite"("schoolId");

GRANT SELECT, INSERT, DELETE ON "Favorite" TO ultm8_app;

ALTER TABLE "Favorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Favorite" FORCE ROW LEVEL SECURITY;
CREATE POLICY "favorite_self_only" ON "Favorite"
  USING ("Favorite"."studentId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- 2. WatchHistory — self-only, same shape as Favorite. UPDATE granted (unlike
--    Favorite) — a playback-progress ping upserts the same row repeatedly.
-- ============================================================================

CREATE TABLE "WatchHistory" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "lastPositionSeconds" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WatchHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WatchHistory_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchHistory_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WatchHistory_studentId_lessonId_key" ON "WatchHistory"("studentId", "lessonId");
CREATE INDEX "WatchHistory_studentId_updatedAt_id_idx" ON "WatchHistory"("studentId", "updatedAt", "id");
CREATE INDEX "WatchHistory_schoolId_idx" ON "WatchHistory"("schoolId");

GRANT SELECT, INSERT, UPDATE ON "WatchHistory" TO ultm8_app;

ALTER TABLE "WatchHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WatchHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY "watch_history_self_only" ON "WatchHistory"
  USING ("WatchHistory"."studentId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- 3. Playlist — self-only. Deliberately no schoolId (see schema.prisma's own
--    comment on this model): a Playlist may mix Lessons from any School the
--    Student is enrolled at.
-- ============================================================================

CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Playlist_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Playlist_studentId_createdAt_id_idx" ON "Playlist"("studentId", "createdAt", "id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "Playlist" TO ultm8_app;

ALTER TABLE "Playlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Playlist" FORCE ROW LEVEL SECURITY;
CREATE POLICY "playlist_self_only" ON "Playlist"
  USING ("Playlist"."studentId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- 4. PlaylistItem — studentId denormalized from playlist.studentId (not a
--    join) so this table's own RLS stays a plain self-only check, same
--    "denormalize the owner/tenant column onto the child row" convention
--    (Decision 30) applied to ownership here instead of tenancy.
-- ============================================================================

CREATE TABLE "PlaylistItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "playlistId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlaylistItem_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlaylistItem_playlistId_lessonId_key" ON "PlaylistItem"("playlistId", "lessonId");
CREATE INDEX "PlaylistItem_playlistId_order_idx" ON "PlaylistItem"("playlistId", "order");
CREATE INDEX "PlaylistItem_studentId_idx" ON "PlaylistItem"("studentId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "PlaylistItem" TO ultm8_app;

ALTER TABLE "PlaylistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlaylistItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY "playlist_item_self_only" ON "PlaylistItem"
  USING ("PlaylistItem"."studentId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- 5. Comment — visible to anyone with an active RoleGrant at the School (same
--    "RLS admits any role, business-layer narrows writes" split
--    class_tenant_isolation established, 20260907000000_classes_module).
--    INSERT restricted to the caller posting as themselves; DELETE's own
--    author-or-staff moderation check happens at the service layer (same
--    split, applied to delete the same way every other write-authorization
--    check in this schema already is) — RLS here only enforces the tenant
--    boundary, not who specifically may delete. No UPDATE at all (no edit,
--    by design — see schema.prisma's own comment on this model).
-- ============================================================================

CREATE TABLE "Comment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "lessonId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Comment_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Comment_lessonId_createdAt_id_idx" ON "Comment"("lessonId", "createdAt", "id");
CREATE INDEX "Comment_schoolId_idx" ON "Comment"("schoolId");

GRANT SELECT, INSERT, DELETE ON "Comment" TO ultm8_app;

-- Three policies, each scoped to an explicit FOR clause — deliberately not
-- one bare USING (which would apply to every command, including INSERT,
-- where it would OR-combine with comment_insert_self_only below and let any
-- active RoleGrant holder at the School insert a Comment under someone
-- ELSE's authorId; caught on review before this ever ran).
ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "comment_select_tenant" ON "Comment"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "Comment"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );
CREATE POLICY "comment_insert_self_only" ON "Comment"
  FOR INSERT
  WITH CHECK ("Comment"."authorId" = current_setting('app.current_user_id', true));
CREATE POLICY "comment_delete_tenant" ON "Comment"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "Comment"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );
