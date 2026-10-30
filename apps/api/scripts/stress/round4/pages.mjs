// Round 4, phase 5: the owner's everyday pages at every School, by School size
// (re-measures phase 2's step 8 on its own). pages-result.json.
import { call, pool, cast, report } from './common.mjs';
const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
const PAGES = (s) => [
  ['dashboard', `/schools/${s.id}/dashboard`], ['students', `/schools/${s.id}/students`], ['search', `/schools/${s.id}/students?search=ma`],
  ['export', `/schools/${s.id}/students/export`], ['staff', `/schools/${s.id}/staff`], ['transactions', `/schools/${s.id}/transactions`],
  ['calendar-month', `/schools/${s.id}/timetable/calendar?from=${from}&to=${to}`], ['timetable', `/schools/${s.id}/timetable`], ['classes', `/schools/${s.id}/classes`],
  ['plans', `/schools/${s.id}/membership-plans`], ['plan-members', `/membership-plans/${s.plans.Unlimited}/members`], ['waivers', `/schools/${s.id}/waivers`],
  ['cancellations', `/schools/${s.id}/cancellations`], ['birthdays', `/schools/${s.id}/birthdays`],
];
const t0 = Date.now();
await pool(cast.schools, +(process.env.CONC || 16), async (s) => { for (const [k, p] of PAGES(s)) await call(`page:${k}:${s.size}`, 'GET', p, s.owner.tok); });
console.log(`${cast.schools.length * 14} page calls in ${(Date.now() - t0) / 1000} s`);
report(['page:'], './pages-result.json');
process.exit(0);
