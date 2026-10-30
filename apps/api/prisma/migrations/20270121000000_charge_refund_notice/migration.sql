-- The refund notice (Decision 414 item 4; v1.3 backlog §3.6): a refund of a
-- payment toward charges sends the member a "Refund" notice (a Guardian gets
-- the usual copy), with its own switch on the School page among the payment
-- notices (Decision 338 item 10), on by default. Sent for a refund to the
-- card, money given back, credit, or a refund made in the Stripe dashboard;
-- a lost dispute already has the dispute notice and sends none.

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "chargeNoticeRefund" BOOLEAN NOT NULL DEFAULT true;
