-- Decision 422 item 2: the owner can switch off "require a booking" for
-- check-in. On by default, so check-in still needs a booking, as before.
ALTER TABLE "School" ADD COLUMN "checkInRequireBooking" BOOLEAN NOT NULL DEFAULT true;
