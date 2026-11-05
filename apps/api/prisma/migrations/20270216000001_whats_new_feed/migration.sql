-- Decision 318 item 3: "What's new", written by ULTM8 HQ in Platform Admin
-- and shown to School owners and staff in the School Portal, in their
-- language (English if a translation is missing).
--
-- Platform-wide content with no tenant column, so no RLS (like
-- CardSurchargeCountry). The tenant connection only reads it, and the API
-- shows it only to people with a staff role; writing is Platform Admin's own
-- connection, so a tenant-side bug can't change a post.

CREATE TABLE "ProductUpdate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductUpdate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductUpdate_title_check" CHECK (length("title") BETWEEN 1 AND 200),
    CONSTRAINT "ProductUpdate_body_check" CHECK (length("body") BETWEEN 1 AND 5000)
);

CREATE INDEX "ProductUpdate_createdAt_id_idx" ON "ProductUpdate"("createdAt", "id");

CREATE TABLE "ProductUpdateTranslation" (
    "id" TEXT NOT NULL,
    "productUpdateId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "ProductUpdateTranslation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductUpdateTranslation_title_check" CHECK (length("title") BETWEEN 1 AND 200),
    CONSTRAINT "ProductUpdateTranslation_body_check" CHECK (length("body") BETWEEN 1 AND 5000)
);

CREATE UNIQUE INDEX "ProductUpdateTranslation_productUpdateId_locale_key" ON "ProductUpdateTranslation"("productUpdateId", "locale");

ALTER TABLE "ProductUpdateTranslation" ADD CONSTRAINT "ProductUpdateTranslation_productUpdateId_fkey"
  FOREIGN KEY ("productUpdateId") REFERENCES "ProductUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT ON "ProductUpdate", "ProductUpdateTranslation" TO ultm8_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ProductUpdate", "ProductUpdateTranslation" TO ultm8_platform_admin;
