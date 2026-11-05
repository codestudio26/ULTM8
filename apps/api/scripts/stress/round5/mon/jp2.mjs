// MON review: JP-2 live. A yen charge with a 33.33% discount at the JP School (10% tax included), paid in whole yen at the desk.
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('../jp/jp-cast.json', import.meta.url)));
const S = C.schoolId;
const O = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const school = await db.school.findUnique({ where: { id: S }, select: { taxRateBasisPoints: true, taxInclusive: true, defaultCurrency: true } });
const withCharges = new Set((await db.charge.findMany({ where: { schoolId: S }, select: { studentId: true } })).map((c) => c.studentId));
const st = C.bulk.find((b) => !withCharges.has(b.id));
const due = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
const ch = await call('ch', 'POST', `/schools/${S}/students/${st.id}/charges`, O, { description: 'MON review 帯 33.33%引き', amount: 100000, discountType: 'PERCENT', discountValue: 3333, dueDate: due });
const c = ch.body;
console.log('school', JSON.stringify(school), 'charge', ch.status, JSON.stringify({ unit: c.unitAmount, discount: c.discountAmount, net: c.netAmount, tax: c.taxAmount, gross: c.grossAmount }));
const whole = Math.floor(c.grossAmount / 100) * 100;
const pay = await call('pay', 'POST', `/schools/${S}/students/${st.id}/charge-payments`, O, { chargeId: c.id, amount: whole, paymentMethod: 'CASH' });
const list = await call('list', 'GET', `/schools/${S}/students/${st.id}/charges`, O);
const mine = (list.body?.charges ?? list.body?.items ?? []).find?.((x) => x.id === c.id);
console.log('paid', whole, pay.status, 'charge after', JSON.stringify(mine ? { status: mine.status, owed: mine.owed ?? mine.remaining ?? mine.amountOwed } : list.body).slice(0, 400));
await db.$disconnect();
