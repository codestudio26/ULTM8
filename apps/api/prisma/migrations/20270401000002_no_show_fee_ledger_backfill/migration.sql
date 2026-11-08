-- Decision 448 item 18: the no-show fees already charged (or tried on the
-- card and declined) before no-show fees had ledger rows, now on the
-- Transactions page, by the same rule the API uses from now on
-- (recordNoShowFeeTransaction(), src/payments/off-session-attempts.ts):
-- outcome CHARGED (Successful) or FAILED (Failed), in the School's currency,
-- at a School with a payment account. No saved card (nothing tried), or no
-- School currency, writes no row. Dated when the class's check-in closed (the
-- moment it became a no-show). One row per Booking (bookingId is unique) and
-- per PaymentIntent, so nothing is written twice.
INSERT INTO "Transaction" (
  "id", "schoolId", "studentId", "paymentAccountId", "kind", "bookingId",
  "amount", "currency", "status", "paymentMethod", "stripePaymentIntentId",
  "billingDate", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, b."schoolId", b."studentId", pa."id", 'NO_SHOW_FEE', b."id",
  b."noShowFeeAmount", upper(s."defaultCurrency"),
  CASE WHEN b."noShowFeeOutcome" = 'CHARGED' THEN 'SUCCESSFUL'::"TransactionStatus" ELSE 'FAILED'::"TransactionStatus" END,
  'STRIPE', b."stripeNoShowPaymentIntentId",
  COALESCE(c."qrAttendanceEndAt", c."endDate", b."updatedAt"), COALESCE(c."qrAttendanceEndAt", c."endDate", b."updatedAt"), now()
FROM "Booking" b
JOIN "School" s ON s."id" = b."schoolId"
JOIN "PaymentAccount" pa ON pa."schoolId" = b."schoolId"
LEFT JOIN "Class" c ON c."id" = b."classId"
WHERE b."noShowFeeOutcome" IN ('CHARGED', 'FAILED')
  AND b."noShowFeeAmount" IS NOT NULL AND b."noShowFeeAmount" > 0
  AND s."defaultCurrency" IS NOT NULL AND s."defaultCurrency" <> ''
ON CONFLICT DO NOTHING;
