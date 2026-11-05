-- Decision 304 item 3: the School setting "Open mat uses a class credit"
-- (Settings -> Check-in rules), on by default, so open mat takes a Class Pack
-- or Friend Pass credit like any class until the owner turns it off.
ALTER TABLE "School" ADD COLUMN "openMatUsesClassCredit" BOOLEAN NOT NULL DEFAULT true;

-- Whether a seat took a credit from its membership. Every existing seat did.
-- Off only for an open mat booked while the setting is off, so cancelling it
-- gives nothing back. No grant changes: the tables' existing grants cover the
-- new columns.
ALTER TABLE "Booking" ADD COLUMN "creditUsed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BookingAttendee" ADD COLUMN "creditUsed" BOOLEAN NOT NULL DEFAULT true;
