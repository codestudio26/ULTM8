-- Decision 335 (T3) — currency codes on Transaction rows in capitals.
--
-- Purchases with a blank plan currency used to write the fallback "usd" in lower
-- case while plans with a picked currency wrote "USD", so the Transactions page's
-- revenue tile showed one currency as two ("90.00 GBP + 110.00 gbp"). New rows
-- are written in capitals from now on; this brings the existing rows in line.
-- Data only: no column, index or policy changes.
UPDATE "Transaction" SET "currency" = UPPER("currency") WHERE "currency" IS NOT NULL AND "currency" <> UPPER("currency");
