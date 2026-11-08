-- Decision 448 item 18: a no-show fee (Decision 291) is a row on the School's
-- Transactions ledger, like a late-cancellation fee. The new kind only; the
-- rows already charged are backfilled by the next migration (a new enum value
-- can't be used in the transaction that adds it).
ALTER TYPE "TransactionKind" ADD VALUE IF NOT EXISTS 'NO_SHOW_FEE';

-- Decision 448 item 3: the amount the 7-day plan-switch notice quoted, the
-- most the switch may charge. Null for notices sent before this.
ALTER TABLE "Membership" ADD COLUMN "switchNoticeAmount" INTEGER;
ALTER TABLE "Membership" ADD COLUMN "switchNoticeCurrency" TEXT;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_switchNoticeAmount_check" CHECK ("switchNoticeAmount" IS NULL OR "switchNoticeAmount" >= 0);
