-- Decision 388: a locked front-desk tablet ends after too many wrong staff
-- codes, so a code can't be guessed in the session's 24 hours.
ALTER TABLE "FrontDeskSession" ADD COLUMN "wrongCodeCount" INTEGER NOT NULL DEFAULT 0;
