// MON review: CA-1 on the shared API with the card path. A plan saved with no currency at a CAD School; late cancel.
import fs from 'fs';
import { db, call, randomUUID, grant, tokenRca } from '../../round4/common.mjs';
const FAKE = 'http://localhost:12111';
const C = JSON.parse(fs.readFileSync(new URL('../ca/cast-ca.json', import.meta.url)));
const S = C.schoolId;
const O = tokenRca({ id: C.owner.id, email: C.owner.email }, [grant('SCHOOL_OWNER_MANAGER', S)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const school = await db.school.findUnique({ where: { id: S }, select: { defaultCurrency: true, defaultRefundCutoffHours: true } });
const used = new Set((await db.membership.findMany({ where: { schoolId: S }, select: { studentId: true } })).map((m) => m.studentId));
const cand = [];
for (const a of C.adults) { if (used.has(a.id)) continue; const g = await db.roleGrant.findFirst({ where: { userId: a.id, schoolId: S, role: 'STUDENT', branchId: C.van } }); if (g) cand.push(a); if (cand.length >= 2) break; }
// Round 6: on round 5's shared stack ca/money.mjs had already set a 24 h refund cut-off at
// this School; on a fresh seed it is unset, so no cancel is ever "late". Set it as the owner.
if (school.defaultRefundCutoffHours == null) console.log('set cut-off', (await call('cutoff', 'PATCH', `/schools/${S}`, O, { defaultRefundCutoffHours: 24 })).status);
const p = await call('plan', 'POST', `/schools/${S}/membership-plans`, O, { type: 'CLASS_PACK', title: `MON review no-currency ${Date.now() % 1e5}`, price: 17500, classesIncluded: 5, cancellationCharge: 1500 });
console.log('school', school, 'plan', p.status, 'currency', p.body?.currency);
const start = Date.now() + 3 * 3600e3;
const cls = await call('class', 'POST', `/schools/${S}/classes`, O, { branchId: C.van, instructorId: C.instr[0].id, title: 'MON review late cancel', styles: [{ disciplineId: C.disciplineId, classType: 'Adult Fundamentals' }], startDate: new Date(start).toISOString(), endDate: new Date(start + 3600e3).toISOString(), capacity: 30, membershipInclusion: true });
console.log('class', cls.status, cls.body?.error ?? '');
const a = cand[0];
const cus = await (await fetch(`${FAKE}/v1/customers`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=x' })).json();
await fetch(`${FAKE}/v1/customers/${cus.id}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'invoice_settings[default_payment_method]=pm_card_visa' });
await db.membership.create({ data: { id: randomUUID(), studentId: a.id, schoolId: S, membershipPlanId: p.body.id, frequency: 'ONE_TIME', classesRemaining: 5 } });
await db.studentPaymentMethod.upsert({ where: { studentId_schoolId: { studentId: a.id, schoolId: S } }, create: { id: randomUUID(), studentId: a.id, schoolId: S, stripeCustomerId: cus.id }, update: { stripeCustomerId: cus.id } });
const tok = tokenRca({ id: a.id, email: a.email }, [grant('STUDENT', S, C.van)]);
const bk = await call('book', 'POST', `/classes/${cls.body.id}/book`, tok, {});
const c = await call('cancel', 'PATCH', `/bookings/${bk.body.id}/cancel`, tok, {});
await sleep(800);
const tx = await db.transaction.findFirst({ where: { bookingId: bk.body.id, kind: 'LATE_CANCEL_FEE' } });
const pi = tx?.stripePaymentIntentId ? await (await fetch(`${FAKE}/v1/payment_intents/${tx.stripePaymentIntentId}`)).json() : null;
const out = { book: bk.status, cancel: c.status, outcome: c.body?.cancellationChargeOutcome ?? (await db.booking.findUnique({ where: { id: bk.body.id } })).cancellationChargeOutcome, tx: tx && { amount: tx.amount, currency: tx.currency, status: tx.status }, stripePI: pi && { amount: pi.amount, currency: pi.currency } };
console.log(JSON.stringify(out));
fs.writeFileSync(new URL('./ca1-out.json', import.meta.url), JSON.stringify(out, null, 1));
await db.$disconnect();
