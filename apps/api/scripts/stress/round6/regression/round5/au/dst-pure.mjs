// Runs the built generator's pure function (dist) over the 2027 DST nights for
// Sydney (+10/+11, 02:00<->03:00) and Lord Howe (+10:30/+11, 02:00<->02:30), and Perth (no DST).
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const { buildSlotOccurrences } = require('./dist/timetable/slot-occurrences.js');
const { DateTime } = require('luxon');
const t = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);
const cases = [
  ['Australia/Sydney', '02:30', '03:30', '2027-03-29T00:00:00Z', 'fall back 4 Apr 2027'],
  ['Australia/Sydney', '02:30', '03:30', '2027-09-27T00:00:00Z', 'spring fwd 3 Oct 2027'],
  ['Australia/Sydney', '01:30', '02:30', '2027-09-27T00:00:00Z', 'spring fwd 3 Oct 2027, ends in gap'],
  ['Australia/Lord_Howe', '01:45', '02:45', '2027-03-29T00:00:00Z', 'fall back 4 Apr 2027'],
  ['Australia/Lord_Howe', '01:45', '02:45', '2027-09-27T00:00:00Z', 'spring fwd 3 Oct 2027'],
  ['Australia/Lord_Howe', '02:00', '02:30', '2027-09-27T00:00:00Z', 'spring fwd, class inside the gap'],
  ['Australia/Lord_Howe', '02:15', '03:00', '2027-09-27T00:00:00Z', 'spring fwd, starts in gap'],
  ['Australia/Perth', '18:00', '19:00', '2027-03-29T00:00:00Z', 'no DST'],
];
for (const [tz, s, e, nowIso, label] of cases) {
  const slot = { id: 'x', schoolId: 's', weekday: 'SUNDAY', startTime: t(s), endTime: t(e), branchId: null, instructorId: null, title: 'x', activities: [], styles: [], bannerUrl: null, description: null, breakStart: null, breakEnd: null, capacity: 10, bookingCutoffMinutesBeforeStart: null, qrAttendanceWindowMinutes: null, refundCutoffHoursBeforeStart: null, cancellationCharge: null, termsWaiverRequired: false, membershipInclusion: true };
  const occ = buildSlotOccurrences(slot, tz, new Date(nowIso));
  const o = occ[0];
  const loc = (d) => DateTime.fromJSDate(d).setZone(tz).toFormat('yyyy-MM-dd HH:mm ZZ');
  console.log(`${tz.padEnd(20)} ${s}-${e} ${label.padEnd(36)} start ${loc(o.startDate)}  end ${loc(o.endDate)}  minutes ${(o.endDate - o.startDate) / 60000}  occDate ${o.occurrenceDate.toISOString().slice(0, 10)}`);
}
