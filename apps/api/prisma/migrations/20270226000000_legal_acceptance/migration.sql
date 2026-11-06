-- Decision 440 — legal pages: the version each page is at, and a record of who
-- accepted which version and when (sign-up, creating a School or Franchise).

ALTER TABLE "LegalDocument" ADD COLUMN "version" TEXT NOT NULL DEFAULT 'unpublished';

-- The three pages added to the two seeded in 20260910000000_settings_module.
-- Content stays NULL until the reviewed text is published.
INSERT INTO "LegalDocument" ("slug", "title", "content", "updatedAt") VALUES
    ('school-agreement', 'School and Franchise Agreement', NULL, CURRENT_TIMESTAMP),
    ('children-notice', 'Children and Guardians Privacy Notice', NULL, CURRENT_TIMESTAMP),
    ('cookie-notice', 'Cookie and Storage Notice', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentSlug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schoolId" TEXT,
    "franchiseId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LegalAcceptance_userId_documentSlug_idx" ON "LegalAcceptance"("userId", "documentSlug");

-- Append-only from the app: no UPDATE or DELETE.
GRANT SELECT, INSERT ON "LegalAcceptance" TO ultm8_app;

ALTER TABLE "LegalAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalAcceptance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "legal_acceptance_self_only" ON "LegalAcceptance"
  USING ("LegalAcceptance"."userId" = current_setting('app.current_user_id', true));
