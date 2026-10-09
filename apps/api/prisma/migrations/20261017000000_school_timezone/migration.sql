-- School time zone (Decisions 76, 172): the same optional IANA time zone field
-- Branch already has. Additive; existing schools start with none (UTC, as today).
ALTER TABLE "School" ADD COLUMN "timezone" TEXT;
