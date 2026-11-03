-- Decision 422 item 6: past attendance of any age can be imported from a
-- spreadsheet. It was paid for elsewhere, so it uses no pack or class credit
-- and no Membership funds it: Booking.sourceMembershipId is null for such a
-- booking. Every other booking still names the Membership that paid for it.
-- Nothing else changes: the foreign key, its ON DELETE RESTRICT, the indexes
-- and the RLS policies stay as they are.
ALTER TABLE "Booking" ALTER COLUMN "sourceMembershipId" DROP NOT NULL;
