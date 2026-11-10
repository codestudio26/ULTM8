// Adds fee, refund, surcharge and month-boundary rows to two demo Schools
// (written directly: the demo's card accounts are pretend ids the fake Stripe
// never made), so the Franchise comparison covers Fees and refunds too.
import crypto from 'crypto';
import { DateTime } from 'luxon';
import { db } from './lib.mjs';
const F = 'de300000-0000-4000-8000-000000000001';
const schools = await db.school.findMany({ where: { franchiseId: F } });
const add = async (s, kind, amount, cur, at, extra = {}) => {
  const st = await db.roleGrant.findFirst({ where: { schoolId: s.id, role: 'STUDENT', revokedAt: null } });
  const pa = await db.paymentAccount.findUnique({ where: { schoolId: s.id } });
  return db.transaction.create({ data: { id: crypto.randomUUID(), schoolId: s.id, studentId: st.userId, paymentAccountId: pa.id, kind, amount, currency: cur, status: 'SUCCESSFUL', paymentMethod: 'STRIPE', billingDate: at, ...extra } });
};
for (const s of schools.filter((x) => ['EUR', 'BRL', 'GBP'].includes(x.defaultCurrency)).slice(0, 4)) {
  const z = DateTime.now().setZone(s.timezone);
  const cur = s.defaultCurrency;
  await add(s, 'NO_SHOW_FEE', 500, cur, z.startOf('month').plus({ minutes: 10 }).toJSDate());
  await add(s, 'LATE_CANCEL_FEE', 300, cur, z.startOf('month').minus({ minutes: 10 }).toJSDate(), { refundedAmount: 120 });
  await add(s, 'FREEZE_FEE', 700, cur, z.minus({ months: 2 }).toJSDate(), { status: 'REFUNDED', refundedAmount: 700 });
  await add(s, 'CHARGE_PAYMENT', 4000, cur, z.minus({ days: 3 }).toJSDate(), { surchargeAmount: 80 });
  await add(s, 'MEMBERSHIP', 6000, cur.toLowerCase(), z.minus({ days: 5 }).toJSDate(), { surchargeAmount: 120, joiningFeeAmount: 2000, joiningFeeRefundable: false, refundedAmount: 5000 });
}
console.log('added');
await db.$disconnect();
