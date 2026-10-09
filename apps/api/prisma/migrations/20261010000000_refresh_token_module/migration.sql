-- Closes ultm8-nestjs-module SKILL.md §7's own confirmed gap: "A general
-- refresh-token endpoint (Spec §8.3 describes one; AuthModule's login() returns
-- only { accessToken }, nothing implements it)". Delivered as a plain JSON
-- response field (no httpOnly-cookie/CORS-credentials work — that's the part §7
-- deliberately deferred and this migration does not touch).
--
-- Hand-written, not `prisma migrate dev`-generated: this sandbox's live DB has
-- pre-existing drift against migration history unrelated to this change (every
-- other table's "id" column DEFAULT, and dozens of unrelated FK constraints) —
-- diffing against it would have produced a mass DROP/ADD CONSTRAINT migration
-- across the whole schema. This migration is scoped to exactly the one new
-- table, matching every other migration in this codebase's own hand-written
-- convention.

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security — ultm8_auth only, same realm as the existing
-- user_auth_lookup policy on "User" (PrismaAuthService's own header comment):
-- a refresh/logout/rotation call presents a bare token with no tenant/session
-- context established yet, structurally identical to the pre-authentication
-- credential-lookup problem that policy already exists to solve. ultm8_app
-- (the ordinary authenticated-tenant-context role) gets no grant on this table
-- at all — nothing in this phase exposes a "list/revoke my own sessions"
-- endpoint, so there is no authenticated-tenant-context path that needs one.
--
-- Unlike ultm8_auth's SELECT-only grant on "User", this role needs SELECT,
-- INSERT, and UPDATE here (create at login, look up + rotate at refresh,
-- revoke at logout/reuse-detection/passcode-reset) — still never DELETE, same
-- "flip status, don't delete" convention as every other audit-relevant table.
-- A single FOR ALL policy is sufficient: Postgres only consults RLS for
-- commands the role's table-level GRANT already permits, and DELETE is never
-- granted below, so this policy being technically permissive for DELETE too
-- has no actual effect.
-- ============================================================================

ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" FORCE ROW LEVEL SECURITY;

CREATE POLICY "refresh_token_auth_realm_only" ON "RefreshToken"
  FOR ALL
  TO ultm8_auth
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON "RefreshToken" TO ultm8_auth;
