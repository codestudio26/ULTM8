-- Decision 435 item 22, the owner's answer of 6 Nov 2026: whether Branch
-- Staff with the "Payroll" switch see the pay rates in the payroll report is
-- the School owner's choice. Off by default: they see the classes, hours and
-- pay, and the API leaves the rates out. On, they see the rates read-only.
-- Owners always see them. School's existing grants and policies apply.
ALTER TABLE "School" ADD COLUMN "payrollStaffSeeRates" BOOLEAN NOT NULL DEFAULT false;
