// Attack F: freezing a monthly plan billed to the balance (Decision 442
// item 5, #513; the rule as Decision 443 item 1 words it). Brazil School.
// Billing days are placed by moving the membership back in time (backdate).
import { call, must, db, rec, expect, makeMember, job, series, charges, d, addDays, todayIn, backdate, buyMonthly, saveOut } from './lib.mjs';
import { school, done } from './common.mjs';

const A = 'freeze';
const s = await school('br');
const O = () => s.owner.tok;
const tz = s.c.tz;
const T = todayIn(tz);
const plus = (n) => addDays(T, n);
const monthAdd = (day, n) => { const [y, m, dd] = day.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`; };
await db.school.update({ where: { id: s.id }, data: { freezeMaxDaysPer12Months: 365 } });

/** A member on the monthly plan whose next billing day is `inDays` from today. */
async function onMonthly(name, inDays) {
  const m = await makeMember(s, name, 'Gelo');
  const { m: mem } = await buyMonthly(s, m, s.plans.monthly2);
  // The next billing day is one month after the start: move the start back so it lands inDays from today.
  let sr = await series(mem.id);
  for (let back = 0; back < 40; back++) {
    if (d(sr.nextDate) === plus(inDays)) break;
    sr = await backdate(mem.id, 1);
  }
  return { m, mem, sr: await series(mem.id) };
}
const freeze = (mem, startsAt, endsAt) => call('POST', `/schools/${s.id}/memberships/${mem.id}/freezes`, O(), { startsAt, endsAt });

// F1: across a billing day: billed in 6 days, frozen from +3 for 30 days -> next +36.
{
  const { mem, sr } = await onMonthly('Fe', 6);
  const f = await freeze(mem, plus(3), plus(33));
  const after = await series(mem.id);
  expect(A, 'F1 freeze across a billing day moves that month by the freeze length', f.status < 300 && d(after.nextDate) === plus(36), { freeze: f.status, err: f.body?.error?.message, before: d(sr.nextDate), after: d(after.nextDate), want: plus(36) });
  // Live through it: 70 days later, the job charges months only outside the freeze.
  await backdate(mem.id, 70);
  await job('charge-recurring');
  const ch = await charges(sr.id);
  const fz = await db.membershipFreeze.findFirst({ where: { membershipId: mem.id } });
  const inside = ch.filter((c) => d(c.occurrenceDate) >= d(fz.startsAt) && d(c.occurrenceDate) < d(fz.endsAt));
  expect(A, 'F1b after living through it: no month charged on a frozen day; one month after it', inside.length === 0 && ch.length >= 1, { charged: ch.map((c) => d(c.occurrenceDate)), freeze: [d(fz.startsAt), d(fz.endsAt)] });
}

// F2: a freeze starting today, ended early the same day: nothing frozen, back to the old day.
{
  const { mem, sr } = await onMonthly('Fi', 6);
  const f = await freeze(mem, T, plus(30));
  const mid = await series(mem.id);
  const e = await call('POST', `/schools/${s.id}/freezes/${f.body?.id}/end`, O(), {});
  const after = await series(mem.id);
  expect(A, 'F2 freeze from today ended the same day: the month moves later, then back to its old day', d(mid.nextDate) === plus(36) && e.status < 300 && d(after.nextDate) === plus(6), { approve: f.status, mid: d(mid.nextDate), end: e.status, endErr: e.body?.error?.message, after: d(after.nextDate), want: plus(6) });
}

// F3: ended early after 10 frozen days: moves back by the 20 unused days.
{
  const { mem, sr } = await onMonthly('Fo', 16);
  const f = await freeze(mem, T, plus(30));
  const mid = await series(mem.id);
  await backdate(mem.id, 10); // 10 days later
  const e = await call('POST', `/schools/${s.id}/freezes/${f.body?.id}/end`, O(), {});
  const after = await series(mem.id);
  // Original next day was +16 (now +6 after the clock move); +30 frozen = +36; 20 unused back = +16.
  expect(A, 'F3 ended early after 10 of 30 days: the month is 10 days later than it was', d(mid.nextDate) === plus(46) && e.status < 300 && d(after.nextDate) === plus(16), { mid: d(mid.nextDate), end: e.status, endErr: e.body?.error?.message, after: d(after.nextDate), want: plus(16) });
}

// F4: a freeze starting ON a billing day moves that day's month.
{
  const { mem } = await onMonthly('Fu', 5);
  const f = await freeze(mem, plus(5), plus(35));
  const after = await series(mem.id);
  expect(A, 'F4 freeze starting on a billing day moves that month by the freeze length', f.status < 300 && d(after.nextDate) === plus(35), { freeze: f.status, after: d(after.nextDate), want: plus(35) });
}

// F5: a billing day the day before the freeze is still charged first.
{
  const { mem, sr } = await onMonthly('Fa', 5);
  const f = await freeze(mem, plus(6), plus(36));
  const mid = await series(mem.id);
  await backdate(mem.id, 7);
  await job('charge-recurring');
  const after = await series(mem.id);
  const ch = await charges(sr.id);
  const billed = d(ch[0]?.occurrenceDate);
  const want = addDays(monthAdd(billed ?? T, 1), 30);
  expect(A, 'F5 the billing day before the freeze is charged; the month after moves by 30', d(mid.nextDate) === plus(5) && ch.length === 1 && billed === plus(-2) && d(after.nextDate) === want, { mid: d(mid.nextDate), charged: ch.map((c) => d(c.occurrenceDate)), after: d(after.nextDate), want });
}

// F6: month-end billing days (31st): freeze across 30 Nov.
{
  const m = await makeMember(s, 'Fim', 'Mes');
  const { m: mem } = await buyMonthly(s, m, s.plans.monthly2);
  const sr0 = await series(mem.id);
  // Started 31 Jan 2026: billing on the 31st, the last day of shorter months. Next: 30 Nov 2026.
  await db.membership.update({ where: { id: mem.id }, data: { startDate: new Date('2026-01-31T15:00:00Z') } });
  await db.recurringCharge.update({ where: { id: sr0.id }, data: { firstDate: new Date('2026-01-31'), nextIndex: 10, nextDate: new Date('2026-11-30') } });
  const f = await freeze(mem, plus(1), plus(31));
  const after = await series(mem.id);
  const want = addDays('2026-11-30', 30);
  expect(A, 'F6 billed on the 31st (30 Nov next), frozen 30 days: next month moves to 30 Dec', f.status < 300 && d(after.nextDate) === want, { freeze: f.status, err: f.body?.error?.message, after: d(after.nextDate), want, first: d(after.firstDate), idx: after.nextIndex });
  rec(A, 'F6b the months after (as built: the new day of the month stays)', 'NOTE', [1, 2, 3, 4].map((i) => monthAdd(d(after.firstDate), after.nextIndex + i - (0)).slice(0, 10)));
  // 29 Feb / 28 Feb: started 29 Jan, next billing 28 Feb 2027 (not a leap year), freeze across it.
}

// F7: cancel during a freeze: ends on the moved billing day, never charged inside.
{
  const { m, mem, sr } = await onMonthly('Fx', 6);
  const f = await freeze(mem, T, plus(30));
  const can = await call('POST', `/memberships/${mem.id}/cancel`, m.tok, {});
  const mc = await db.membership.findUnique({ where: { id: mem.id } });
  const cancelDay = mc.cancelAt ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(mc.cancelAt) : null;
  expect(A, 'F7 cancel during a freeze: ends on the moved billing day (+36), series ends the day before', can.status < 300 && cancelDay === plus(36), { cancel: can.status, err: can.body?.error?.message, cancelDay, want: plus(36), endDate: d((await series(mem.id)).endDate) });
  // ...then the freeze is ended early today: 0 days frozen. They paid up to +6.
  const e = await call('POST', `/schools/${s.id}/freezes/${f.body?.id}/end`, O(), {});
  const mc2 = await db.membership.findUnique({ where: { id: mem.id } });
  const fmt = (x) => (x ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x) : null);
  const st = await call('GET', `/schools/${s.id}/students/${m.id}/memberships`, O());
  const row = (Array.isArray(st.body) ? st.body : st.body?.memberships ?? st.body?.items ?? []).find?.((x) => x.id === mem.id);
  rec(A, 'F7b cancelled during a freeze, then the freeze ended early (0 days frozen): when does it end?', fmt(mc2.expiryDate) === plus(6) && fmt(mc2.cancelAt) === plus(6) ? 'PASS' : 'NOTE', { end: e.status, cancelAt: fmt(mc2.cancelAt), expiryDate: fmt(mc2.expiryDate), paidUpTo: plus(6), screen: row ? { cancelAt: row.cancelAt, expiryDate: row.expiryDate } : st.status });
}

// F8: a member's freeze request approved twice at once, with the job: moved once.
{
  const { m, mem } = await onMonthly('Fy', 6);
  const r = await call('POST', `/memberships/${mem.id}/freeze-requests`, m.tok, { startsAt: plus(2), endsAt: plus(12) });
  const [a1, a2, j] = await Promise.allSettled([
    call('POST', `/schools/${s.id}/freezes/${r.body?.id}/approve`, O(), {}),
    call('POST', `/schools/${s.id}/freezes/${r.body?.id}/approve`, O(), {}),
    job('charge-recurring'),
  ]);
  await job('charge-recurring');
  const after = await series(mem.id);
  expect(A, 'F8 a freeze approved twice at once (and the job) moves the month once', d(after.nextDate) === plus(16), { request: r.status, err: r.body?.error?.message, approvals: [a1.value?.status, a2.value?.status], after: d(after.nextDate), want: plus(16) });
}

// F9: a freeze cancelled before it starts (ended early before its first day) undoes the move.
{
  const { mem } = await onMonthly('Fz', 6);
  const f = await freeze(mem, plus(2), plus(12));
  const mid = await series(mem.id);
  const e = await call('POST', `/schools/${s.id}/freezes/${f.body?.id}/end`, O(), {});
  const after = await series(mem.id);
  expect(A, 'F9 a future freeze ended before it starts: the month goes back to its day', d(mid.nextDate) === plus(16) && d(after.nextDate) === plus(6), { mid: d(mid.nextDate), end: e.status, err: e.body?.error?.message, after: d(after.nextDate) });
}

// F10: the freeze fee at a School without cards is a waiting Pix/cash payment.
{
  await db.school.update({ where: { id: s.id }, data: { freezeFeeAmount: 1990 } });
  const { mem } = await onMonthly('Fee', 6);
  const f = await freeze(mem, plus(1), plus(11));
  const fz = await db.membershipFreeze.findUnique({ where: { id: f.body?.id } });
  const t = fz?.feeTransactionId ? await db.transaction.findUnique({ where: { id: fz.feeTransactionId } }) : null;
  expect(A, 'F10 freeze fee at a no-card School is a waiting bank-transfer payment, in BRL', t?.status === 'PENDING' && t?.paymentMethod === 'BANK_TRANSFER' && t?.amount === 1990 && t?.currency === 'BRL', { tx: t && { status: t.status, method: t.paymentMethod, amount: t.amount, cur: t.currency } });
  await db.school.update({ where: { id: s.id }, data: { freezeFeeAmount: null } });
}

saveOut('freeze-out.json');
await done();
