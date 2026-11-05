// Round 5 US: the real generator function (built dist) run with a pretend "now"
// just before each US DST change, for the four Branch zones. Prints each
// occurrence's local start/end, length, booking cut-off and refund cut-off.
//   node dst.mjs
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { buildSlotOccurrences } = require('./dist/timetable/slot-occurrences.js');
const { DateTime } = require('luxon');

const t = (hhmm) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const slot = (weekday, s, e, extra = {}) => ({ id: 'x', schoolId: 's', branchId: 'b', instructorId: 'i', title: `${weekday} ${s}-${e}`, activities: [], styles: [], bannerUrl: null, description: null,
  weekday, startTime: t(s), endTime: t(e), breakStart: null, breakEnd: null, capacity: 10, bookingCutoffMinutesBeforeStart: 60, qrAttendanceWindowMinutes: 30, refundCutoffHoursBeforeStart: 24,
  cancellationCharge: null, termsWaiverRequired: false, membershipInclusion: true, ...extra });
const ZONES = ['America/New_York', 'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu'];
const CHANGES = [['2027-03-14', '2027-03-01T12:00:00Z'], ['2027-11-07', '2027-10-25T12:00:00Z']];
const SLOTS = [slot('SUNDAY', '06:00', '07:00'), slot('SUNDAY', '01:30', '02:30'), slot('SUNDAY', '02:00', '03:00'), slot('SUNDAY', '01:00', '02:00'), slot('MONDAY', '06:00', '07:00')];
const fmt = (d, z) => DateTime.fromJSDate(d).setZone(z).toFormat('ccc dd LLL HH:mm ZZZZ');
const problems = [];
for (const [day, nowIso] of CHANGES) {
  for (const z of ZONES) {
    for (const s of SLOTS) {
      for (const o of buildSlotOccurrences(s, z, new Date(nowIso))) {
        const mins = (o.endDate - o.startDate) / 60000;
        const want = (s.endTime - s.startTime) / 60000;
        const ls = DateTime.fromJSDate(o.startDate).setZone(z).toFormat('HH:mm');
        const near = Math.abs(DateTime.fromISO(day, { zone: z }).toMillis() - o.startDate.getTime()) < 9 * 86400e3;
        if (!near) continue;
        const refundWall = DateTime.fromJSDate(o.startDate).setZone(z).diff(DateTime.fromJSDate(o.refundFeeDate).setZone(z), 'hours').hours;
        const refundLocal = fmt(o.refundFeeDate, z);
        const line = `${z.padEnd(20)} ${s.title.padEnd(18)} start ${fmt(o.startDate, z)} end ${fmt(o.endDate, z)} len ${mins}m refund-cutoff ${refundLocal}`;
        console.log(line);
        if (mins !== want || ls !== s.startTime.toISOString().slice(11, 16)) problems.push(line);
      }
    }
  }
}
console.log('\nOccurrences whose length or local start differs from the slot:\n' + problems.join('\n'));
