-- Decision 450 item 8 (10 Nov 2026): the late "Payment
-- confirmed" notice for a saved-card purchase (Decision 449 item 11) gets its
-- own notification type (CARD_PAYMENT_CONFIRMED) and its own switch on the
-- School page among the payment notices (Decision 338 item 10), separate from
-- the cash and bank payment notice (CASH_PAYMENT) it shared until now. On by
-- default, so every existing School keeps sending it.

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "chargeNoticeCardConfirmed" BOOLEAN NOT NULL DEFAULT true;
