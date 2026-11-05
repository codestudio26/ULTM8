// T6: AED money — VAT 5% inclusive charges with Arabic descriptions, desk payment, refund; tax-rates table for AE; Ramadan pack price.
import { C, tk, call, S, short, db, checks, codes } from './lib.mjs';
const { ok, save } = checks('t6-money');
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const rates = await call('t6:tax-rates', 'GET', '/tax-rates', tOwner);
const ae = JSON.stringify(rates.body).match(/.{0,80}"AE".{0,120}/)?.[0];
ok('T6a tax-rates lists UAE VAT 5%', rates.status === 200 && /AE/.test(JSON.stringify(rates.body)), `${rates.status} ${ae}`);
const stu = C.sp.bidi;
const due0 = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);
const due = due0;
const ch = await call('t6:charge', 'POST', `/schools/${S}/students/${stu.id}/charges`, tOwner, { description: 'رسوم القفازات Gloves 12oz (٢ زوج)', amount: 42550, dueDate: due });
ok('T6b charge AED 425.50 incl. 5% VAT: tax 20.26, net 405.24', ch.status === 201 && ch.body?.taxAmount === 2026, `${ch.status} ${short({ total: ch.body?.total ?? ch.body?.totalAmount, tax: ch.body?.taxAmount, net: ch.body?.netAmount ?? ch.body?.subtotal, rate: ch.body?.taxRateBasisPoints, cur: ch.body?.currency, err: ch.body?.error })}`);
const pays = await Promise.all(Array.from({ length: 5 }, () => call('t6:pay-cash-x5', 'POST', `/schools/${S}/students/${stu.id}/charge-payments`, tOwner, { chargeId: ch.body?.id, amount: 42550, paymentMethod: 'CASH' })));
ok('T6c desk cash payment clicked 5 times → paid once', pays.filter((r) => r.status < 300).length === 1, `${JSON.stringify(codes(pays))} ${short(pays.find((r) => r.status >= 300)?.body?.error?.message, 140)} ${short(pays.find((r) => r.status < 300)?.body, 200)}`);
const txId = pays.find((r) => r.status < 300)?.body?.id ?? pays.find((r) => r.status < 300)?.body?.transactionId;
const rf = await call('t6:refund-partial', 'POST', `/schools/${S}/charge-payments/${txId}/refund`, tOwner, { amount: 10000, destination: 'MONEY_BACK', notes: 'إرجاع زوج واحد' });
ok('T6d partial refund AED 100 with Arabic reason', rf.status < 300, `${rf.status} ${short(rf.body, 200)}`);
const neg = await Promise.all([
  call('t6:neg', 'POST', `/schools/${S}/students/${stu.id}/charges`, tOwner, { description: 'سالب', amount: -100, dueDate: due }),
  call('t6:zero', 'POST', `/schools/${S}/students/${stu.id}/charges`, tOwner, { description: 'صفر', amount: 0, dueDate: due }),
  call('t6:huge', 'POST', `/schools/${S}/students/${stu.id}/charges`, tOwner, { description: 'ضخم', amount: 2 ** 31, dueDate: due }),
  call('t6:frac', 'POST', `/schools/${S}/students/${stu.id}/charges`, tOwner, { description: 'كسر', amount: 10.5, dueDate: due }),
  call('t6:arabic-digits', 'POST', `/schools/${S}/students/${stu.id}/charges`, tOwner, { description: 'أرقام', amount: '٤٢٥', dueDate: due }),
  call('t6:refund-too-much', 'POST', `/schools/${S}/charge-payments/${txId}/refund`, tOwner, { amount: 999999, destination: 'MONEY_BACK' }),
]);
ok('T6e negative, zero, 2^31, fractional, Arabic-digit amounts and over-refund refused (4xx)', neg.every((r) => r.status >= 400 && r.status < 500), neg.map((r) => r.status).join(','));
save(); await db.$disconnect();
