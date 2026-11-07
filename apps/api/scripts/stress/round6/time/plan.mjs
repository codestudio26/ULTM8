// Round 6 T: writes the clock plan(s) for the simulated months.
//   node plan.mjs FROM TO [file]     e.g. node plan.mjs 2026-11-08 2027-04-12 out/plan.json
// Each day gets the scheduler's own UTC times for the daily jobs. Clock-change
// days and month ends also get extra charge-recurring runs every 3 hours (as a
// late or repeated run would), which must never make a second charge or a
// charge on the wrong day. The FZ_EARLY freezes are ended at their time.
import fs from 'fs';
import { DateTime } from 'luxon';
import { OUT } from './lib.mjs';

const [from = '2026-11-08', to = '2027-04-12', file = `${OUT}/plan.json`] = process.argv.slice(2);
const days = JSON.parse(fs.readFileSync(`${OUT}/days.json`, 'utf8'));
const DST = new Set(['2027-03-14', '2027-03-28', '2027-04-04', '2027-03-13', '2027-03-27', '2027-04-03']);
const steps = [];
for (let d = DateTime.fromISO(from, { zone: 'UTC' }); d <= DateTime.fromISO(to, { zone: 'UTC' }); d = d.plus({ days: 1 })) {
  const day = d.toISODate();
  const at = (hm) => `${day}T${hm}:00.000Z`;
  const extra = DST.has(day) || d.day >= 28 || d.day === 1;
  if (extra) for (const hm of ['00:10', '03:00', '09:00', '12:00', '15:00', '18:00', '21:00', '23:50']) steps.push({ at: at(hm), jobs: ['charge-recurring'] });
  steps.push({ at: at('04:00'), jobs: ['account-erasure'] });
  steps.push({ at: at('05:00'), jobs: ['waiver-renewal-sweep'] });
  steps.push({ at: at('05:30'), jobs: ['charge-recurring', 'plan-switch', 'plan-waitlist', 'membership-expiry-sweep'] });
  steps.push({ at: at('06:00'), jobs: ['charge-auto-pay'] });
  steps.push({ at: at('06:30'), jobs: ['charge-due-reminder'] });
  steps.push({ at: at('06:45'), jobs: ['membership-expiry-reminder'] });
  steps.push({ at: at('07:00'), jobs: ['late-fee', 'charge-overdue-notice'] });
  steps.push({ at: at('07:30'), jobs: ['membership-ending-report'] });
  for (const f of days.freezes.filter((x) => x.endEarlyAt && x.endEarlyAt.slice(0, 10) === day)) {
    steps.push({ at: f.endEarlyAt, calls: [{ tag: `${f.tag} School ${f.i}`, file: 'memberships/freeze/membership-freezes.service', cls: 'MembershipFreezesService', method: 'endByStaff', args: [f.ownerId, f.sid, f.freezeId] }], jobs: [] });
  }
}
steps.sort((a, b) => a.at.localeCompare(b.at));
fs.writeFileSync(file, JSON.stringify(steps));
console.log(`${steps.length} steps, ${from} to ${to} → ${file}`);
