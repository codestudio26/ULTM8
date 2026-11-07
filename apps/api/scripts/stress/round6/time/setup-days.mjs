// Round 6 T: put the balance-billed members (Decision 441 item 1) on chosen
// billing days and add the freezes of Decision 443 item 1's edges.
//   node setup-days.mjs        (after seed.mjs; writes out/days.json)
//
// Shortcut named: the sale date is moved back in the database (as the
// rehearsal moves due dates), and the monthly series is removed so the
// charge-recurring job's own safety net (healBalanceBilling) makes it again
// from the moved date, with the product's own first-date rule. Start times are
// chosen around midnight in the School's zone (00:20 and 23:40 local), where
// the School's day and the UTC day differ.
// Freezes go through the API as the owner (approved at once), and one is
// ended early through the API before it starts. The mid-freeze early end is
// made by clock.cjs at its simulated time (FZ_EARLY).
import { DateTime } from 'luxon';
import { call, must, db, loadCast, OUT, ok, note, sectionOf } from './lib.mjs';
import fs from 'fs';

const cast = loadCast();
const START_DAYS = ['2026-10-26', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-05', '2026-11-07'];
const TIMES = ['00:20', '12:00', '23:40'];
// k (member index) → freeze (startsAt, endsAt = the day back). See README.
export const FREEZES = {
  8: { tag: 'FZ_ON', startsAt: '2027-02-26', endsAt: '2027-03-28' },
  9: { tag: 'FZ_AFTER', startsAt: '2027-01-29', endsAt: '2027-02-12' },
  12: { tag: 'FZ_31', startsAt: '2027-02-20', endsAt: '2027-03-06' },
  13: { tag: 'FZ_DST', startsAt: '2027-03-13', endsAt: '2027-04-05' },
  11: { tag: 'FZ_EARLY', startsAt: '2027-01-10', endsAt: '2027-03-10', endEarlyAt: '2027-02-01T12:00:00Z' },
  14: { tag: 'FZ_BEFORE_ENDED', startsAt: '2027-01-03', endsAt: '2027-01-20', endNow: true },
  15: { tag: 'FZ_ON_7', startsAt: '2027-03-07', endsAt: '2027-03-14' },
};

sectionOf('setup: billing days and freezes');
const ONLY = process.env.SCHOOLS ? new Set(process.env.SCHOOLS.split(',').map(Number)) : null;
const days = ONLY && fs.existsSync(`${OUT}/days.json`) ? JSON.parse(fs.readFileSync(`${OUT}/days.json`, 'utf8')) : { members: [], freezes: [] };
const mine = (x) => x.provider !== 'STRIPE' && (!ONLY || ONLY.has(x.i));
for (const s of cast.schools.filter(mine)) {
  const ms = await db.membership.findMany({ where: { schoolId: s.sid, billedToBalance: true }, select: { id: true, studentId: true } });
  const byStudent = new Map(ms.map((m) => [m.studentId, m.id]));
  const ids = [];
  for (let k = 0; k < s.memberIds.length; k++) {
    const mid = byStudent.get(s.memberIds[k]);
    if (!mid) continue;
    const day = START_DAYS[k % START_DAYS.length];
    const time = TIMES[Math.floor(k / START_DAYS.length) % TIMES.length];
    const start = DateTime.fromISO(`${day}T${time}`, { zone: s.tz }).toUTC().toJSDate();
    ids.push(mid);
    days.members.push({ sid: s.sid, i: s.i, tz: s.tz, k, membershipId: mid, studentId: s.memberIds[k], startLocalDay: day, startAt: start.toISOString(), price: s.price, cur: s.cur });
    await db.membership.update({ where: { id: mid }, data: { startDate: start } });
  }
  const del = await db.recurringCharge.deleteMany({ where: { membershipId: { in: ids }, createdCount: 0 } });
  // Late fees on every other School: fixed 5.00, 3 grace days.
  if (s.i % 2 === 0) {
    const lf = await call('PUT', `/schools/${s.sid}/late-fees`, s.owner.tok, { enabled: true, type: 'FIXED', fixedAmount: 500, graceDays: 3, legalConfirmed: true });
    if (lf.status >= 300) note(`late fees at School ${s.i}`, `${lf.status} ${JSON.stringify(lf.body).slice(0, 200)}`);
    s.lateFees = lf.status < 300;
  }
  note(`School ${s.i} ${s.ck} ${s.tz}`, `${ids.length} memberships moved, ${del.count} series removed for the job to make again`);
}

// The job's safety net makes the series again from the moved dates.
for (const s of cast.schools.filter(mine)) {
  for (const [k, f] of Object.entries(FREEZES)) {
    const m = days.members.find((x) => x.sid === s.sid && x.k === Number(k));
    if (!m) continue;
    const r = await call('POST', `/schools/${s.sid}/memberships/${m.membershipId}/freezes`, s.owner.tok, { startsAt: f.startsAt, endsAt: f.endsAt });
    if (r.status >= 300) { ok(`freeze ${f.tag} at School ${s.i}`, false, `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); continue; }
    let ended = null;
    if (f.endNow) {
      const e = await call('POST', `/schools/${s.sid}/freezes/${r.body.id}/end`, s.owner.tok, {});
      ended = e.status;
      if (e.status >= 300) ok(`end ${f.tag} before it starts at School ${s.i}`, false, `${e.status} ${JSON.stringify(e.body).slice(0, 300)}`);
    }
    days.freezes.push({ ...f, sid: s.sid, i: s.i, tz: s.tz, k: Number(k), membershipId: m.membershipId, freezeId: r.body.id, ownerId: s.owner.id, ended });
  }
}
fs.writeFileSync(`${OUT}/days.json`, JSON.stringify(days, null, 1));
fs.writeFileSync(`${OUT}/cast.json`, JSON.stringify(cast, null, 1));
note('setup done', `${days.members.length} members, ${days.freezes.length} freezes`);
await db.$disconnect();
