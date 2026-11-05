-- Decision 318 item 10: the School's ad tracking, ready-made connections
-- only. The owner enters a Meta Pixel ID and/or a Google Analytics (GA4)
-- measurement ID; ULTM8 never runs a School's own code.
--
-- The CHECK constraints repeat the API's format whitelist, so nothing but an
-- ID (digits only; or G- and capital letters and digits) can ever be stored,
-- whatever writes the row: no quote, bracket or markup can reach a page that
-- later prints these. School's existing grants and policies apply.
ALTER TABLE "School" ADD COLUMN "metaPixelId" TEXT;
ALTER TABLE "School" ADD COLUMN "googleAnalyticsId" TEXT;

ALTER TABLE "School" ADD CONSTRAINT "School_metaPixelId_format" CHECK ("metaPixelId" IS NULL OR "metaPixelId" ~ '^[0-9]{10,20}$');
ALTER TABLE "School" ADD CONSTRAINT "School_googleAnalyticsId_format" CHECK ("googleAnalyticsId" IS NULL OR "googleAnalyticsId" ~ '^G-[A-Z0-9]{4,16}$');
