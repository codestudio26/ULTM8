-- Decision 377: each guest on a booking is checked in on their own at the
-- desk. No new grants or policies: ultm8_app already has UPDATE on
-- BookingAttendee, and booking_attendee_write (the booker or the School
-- Owner/Manager) covers the write, which runs in the booker's context like the
-- member's own check-in does.
ALTER TABLE "BookingAttendee" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "BookingAttendee" ADD COLUMN "checkedInById" TEXT;
ALTER TABLE "BookingAttendee" ADD CONSTRAINT "BookingAttendee_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
