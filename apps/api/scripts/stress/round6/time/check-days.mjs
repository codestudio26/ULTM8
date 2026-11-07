// Round 6 T: checks the simulated months against the rules, worked out here
// independently of the product's own schedule code.
//   node check-days.mjs SIM_END   (the last simulated moment, e.g. 2027-04-12T23:59:00Z)
//
// For every balance-billed member (Decision 441 item 1):
//   - one charge per billing day, never two (Decision 412: the same day of each
//     month, the last day of a shorter month for the 29th to 31st), counted
//     from the sale day in the School's own time zone;
//   - a freeze moves the next charge on or after its first day by its length,
//     and the member keeps the new day (Decision 443 item 1); ended early, the
//     next charge moves back by the days not used, never before that day;
//   - each charge is made on its own day in the School's zone (clock.cjs logs
//     the simulated time each charge was made), for the right School, student
//     and amount;
//   - late fees: at most one per charge (Decision 413), and the same delay
//     after the due date in every time zone.
import fs from 'fs';
import { DateTime } from 'luxon';
import { db, OUT, ok, note, sectionOf } from './lib.mjs';

const simEnd = process.argv[2] || '2027-04-12T23:59:00Z';
const days = JSON.parse(fs.readFileSync(`${OUT}/days.json`, 'utf8'));
const simAt = new Map();
for (const line of fs.existsSync(`${OUT}/charge-sim.jsonl`) ? fs.readFileSync(`${OUT}/charge-sim.jsonl`, 'utf8').split('\n') : []) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (!simAt.has(r.id)) simAt.set(r.id, r);
}

const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addMonthsClip = (anchorY, anchorM, anchorD, n) => {
  const t = anchorM - 1 + n;
  const y = anchorY + Math.floor(t / 12), m = (t % 12) + 1;
  return DateTime.fromObject({ year: y, month: m, day: Math.min(anchorD, dim(y, m)) }, { zone: 'UTC' }).toISODate();
};
const plusDays = (day, n) => DateTime.fromISO(day, { zone: 'UTC' }).plus({ days: n }).toISODate();
const diffDays = (a, b) => DateTime.fromISO(a, { zone: 'UTC' }).diff(DateTime.fromISO(b, { zone: 'UTC' }), 'days').days;
const localDay = (iso, tz) => DateTime.fromISO(iso, { zone: 'UTC' }).setZone(tz).toISODate();

/** The expected billing days in (start, last day] for one member. */
function expected(m, freezes) {
  const lastDay = localDay(simEnd, m.tz);
  // The anchor: the sale day in the School's zone; occurrence 1 is a month later.
  let [ay, am, ad] = m.startLocalDay.split('-').map(Number);
  let n = 1;
  let cur = addMonthsClip(ay, am, ad, n);
  const out = [];
  const fs_ = freezes.map((f) => ({ ...f, applied: false, restored: false }));
  const reanchor = (day) => { [ay, am, ad] = day.split('-').map(Number); n = 0; cur = day; };
  for (let guard = 0; guard < 100 && cur <= lastDay; guard++) {
    for (const f of fs_) {
      if (f.applied) continue;
      const back = f.endedEarlyDay && f.endedEarlyDay < f.endsAt ? (f.endedEarlyDay < f.startsAt ? f.startsAt : f.endedEarlyDay) : f.endsAt;
      const len = diffDays(f.endsAt, f.startsAt);
      // The move is made by the first job run after the charge before the
      // freeze (or at approval); the early end comes later (FZ_EARLY) or before
      // the freeze starts (nothing frozen).
      if (f.endNow) { f.applied = true; continue; }
      if (cur >= f.startsAt) {
        reanchor(plusDays(cur, len));
        f.applied = true;
        if (f.endedEarlyDay) {
          // Ended early after the move: back by the days not used, never before that day.
          const unused = diffDays(f.endsAt, back);
          let moved = plusDays(cur, -unused);
          if (moved < f.endedEarlyDay) moved = f.endedEarlyDay;
          reanchor(moved);
        }
      }
    }
    if (cur > lastDay) break;
    out.push(cur);
    n++;
    cur = addMonthsClip(ay, am, ad, n);
  }
  return out;
}

sectionOf('check: billing days');
const freezesBy = new Map();
for (const f of days.freezes) {
  const ff = { ...f };
  if (f.endEarlyAt) ff.endedEarlyDay = localDay(f.endEarlyAt, f.tz);
  (freezesBy.get(f.membershipId) || freezesBy.set(f.membershipId, []).get(f.membershipId)).push(ff);
}
const series = await db.recurringCharge.findMany({ where: { membershipId: { in: days.members.map((m) => m.membershipId) } }, select: { id: true, membershipId: true, schoolId: true, studentId: true } });
const seriesBy = new Map(series.map((s) => [s.membershipId, s]));
const charges = await db.charge.findMany({ where: { recurringChargeId: { in: series.map((s) => s.id) } }, select: { id: true, recurringChargeId: true, occurrenceDate: true, dueDate: true, schoolId: true, studentId: true, unitAmount: true, grossAmount: true, currency: true } });
const chargesBy = new Map();
for (const c of charges) (chargesBy.get(c.recurringChargeId) || chargesBy.set(c.recurringChargeId, []).get(c.recurringChargeId)).push(c);

const bad = { missing: [], extra: [], dup: [], wrongTenant: [], wrongAmount: [], wrongDay: [], noSeries: [] };
const byTag = {};
for (const m of days.members) {
  const s = seriesBy.get(m.membershipId);
  if (!s) { bad.noSeries.push(m.membershipId); continue; }
  const exp = expected(m, freezesBy.get(m.membershipId) || []);
  const got = (chargesBy.get(s.id) || []).map((c) => c.dueDate.toISOString().slice(0, 10)).sort();
  const seen = new Set();
  for (const g of got) { if (seen.has(g)) bad.dup.push({ m: m.membershipId, day: g }); seen.add(g); }
  for (const e of exp) if (!seen.has(e)) bad.missing.push({ i: m.i, tz: m.tz, k: m.k, start: m.startLocalDay, day: e, got, exp });
  for (const g of seen) if (!exp.includes(g)) bad.extra.push({ i: m.i, tz: m.tz, k: m.k, start: m.startLocalDay, day: g, got, exp });
  for (const c of chargesBy.get(s.id) || []) {
    if (c.schoolId !== m.sid || c.studentId !== m.studentId) bad.wrongTenant.push(c.id);
    if (c.unitAmount !== m.price) bad.wrongAmount.push({ id: c.id, unit: c.unitAmount, price: m.price });
    const sa = simAt.get(c.id);
    if (sa) {
      const made = localDay(sa.simAt, m.tz);
      const due = c.dueDate.toISOString().slice(0, 10);
      if (made !== due) bad.wrongDay.push({ i: m.i, tz: m.tz, due, madeLocal: made, simAt: sa.simAt });
    }
  }
  const fz = (freezesBy.get(m.membershipId) || []).map((f) => f.tag).join(',');
  if (fz) (byTag[fz] ||= []).push({ i: m.i, tz: m.tz, start: m.startLocalDay, exp: exp.join(' '), got: got.join(' ') });
}
for (const [k, v] of Object.entries(bad)) ok(`billing days: ${k}`, v.length === 0, `${v.length} ${JSON.stringify(v.slice(0, 4))}`);
note('charges checked', `${charges.length} charges on ${series.length} series; ${simAt.size} with a simulated time`);
fs.writeFileSync(`${OUT}/freeze-results.json`, JSON.stringify(byTag, null, 1));
for (const [tag, rows] of Object.entries(byTag)) {
  const wrong = rows.filter((r) => r.exp !== r.got);
  ok(`freeze ${tag}: next charges as Decision 443 item 1`, wrong.length === 0, wrong.length ? JSON.stringify(wrong.slice(0, 3)) : `${rows.length} members, e.g. ${rows[0].start} → ${rows[0].got}`);
}

sectionOf('check: late fees');
const lateFees = await db.charge.findMany({ where: { lateFeeForChargeId: { in: charges.map((c) => c.id) } }, select: { id: true, lateFeeForChargeId: true, dueDate: true, schoolId: true } });
const perCharge = new Map();
for (const f of lateFees) perCharge.set(f.lateFeeForChargeId, (perCharge.get(f.lateFeeForChargeId) || 0) + 1);
ok('late fees: at most one per charge', [...perCharge.values()].every((n) => n === 1), `${lateFees.length} late fees`);
const chargeById = new Map(charges.map((c) => [c.id, c]));
const tzBySchool = new Map(days.members.map((m) => [m.sid, m.tz]));
const delays = {};
for (const f of lateFees) {
  const c = chargeById.get(f.lateFeeForChargeId);
  const tz = tzBySchool.get(f.schoolId);
  const sa = simAt.get(f.id);
  const made = sa ? localDay(sa.simAt, tz) : f.dueDate.toISOString().slice(0, 10);
  const d = diffDays(made, c.dueDate.toISOString().slice(0, 10));
  (delays[tz] ||= {})[d] = ((delays[tz] ||= {})[d] || 0) + 1;
  if (c.schoolId !== f.schoolId) ok('late fee in the charge\'s own School', false, f.id);
}
note('late fee delay after the due date (days), by zone (3 grace days)', delays);
const allDelays = new Set(Object.values(delays).flatMap((o) => Object.keys(o)));
ok('late fees: the same delay in every time zone', allDelays.size <= 1, [...allDelays].join(','));
await db.$disconnect();
