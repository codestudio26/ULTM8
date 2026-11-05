// Owner and Branch Staff pages at 4,000 students, 8 owners/staff at once; half-hour zone checks; cross-School probes.
import fs from 'fs';
import { db, call, grant, tokenRca, pool, report } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId;
const tOwner = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const out = {};
const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
const plan = C.plans['Monthly unlimited'];
const P = [['dashboard', `/schools/${S}/dashboard`], ['students', `/schools/${S}/students`], ['export', `/schools/${S}/students/export`], ['staff', `/schools/${S}/staff`], ['transactions', `/schools/${S}/transactions`], ['calendar-month', `/schools/${S}/timetable/calendar?from=${from}&to=${to}`], ['timetable', `/schools/${S}/timetable`], ['classes', `/schools/${S}/classes`], ['plan-members', `/membership-plans/${plan}/members`], ['waivers', `/schools/${S}/waivers`], ['cancellations', `/schools/${S}/cancellations`], ['birthdays', `/schools/${S}/birthdays`], ['att-stats', `/schools/${S}/attendance/stats`], ['att-log', `/schools/${S}/attendance/log-classes`], ['freezes', `/schools/${S}/freezes`]];
const owners = Array.from({ length: 8 }, () => tOwner);
await pool(owners, 8, async (t) => { for (const [k, p] of P) await call(`owner:${k}`, 'GET', p, t); });
const staffT = C.bstaff.map((st) => tokenRca(st, [grant('BRANCH_STAFF', S, st.branchId)]));
await pool(staffT, 8, async (t) => { for (const [k, p] of P) await call(`staff:${k}`, 'GET', p, t); });
const stats = await call('x', 'GET', `/schools/${S}/attendance/stats`, tOwner);
const log = await call('x', 'GET', `/schools/${S}/attendance/log-classes`, tOwner);
const bd = await call('x', 'GET', `/schools/${S}/birthdays`, tOwner);
const istToday = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
out.zone = { istToday, utcToday: new Date().toISOString().slice(0, 10), statsTo: stats.body?.to, statsFrom: stats.body?.from, birthdaysToday: bd.body?.today, logTitles: (log.body?.items || []).map((i) => i.title).slice(0, 5) };
// cross-School: another School's students/export/profile with my owner token; my students with theirs
const others = await db.school.findMany({ where: { id: { not: S }, name: { startsWith: 'R5 ' } }, select: { id: true, name: true }, take: 5 });
const otherAny = await db.school.findMany({ where: { id: { not: S }, name: { not: { startsWith: 'R5 ' } } }, select: { id: true }, take: 3 });
out.cross = [];
for (const o of [...others, ...otherAny]) {
  const st = await db.roleGrant.findFirst({ where: { schoolId: o.id, role: 'STUDENT', revokedAt: null }, select: { userId: true } });
  const rs = await Promise.all([
    call('xt', 'GET', `/schools/${o.id}/students`, tOwner), call('xt', 'GET', `/schools/${o.id}/students/export`, tOwner),
    st ? call('xt', 'GET', `/schools/${o.id}/students/${st.userId}/profile`, tOwner) : { status: '-' },
    st ? call('xt', 'GET', `/schools/${S}/students/${st.userId}/profile`, tOwner) : { status: '-' },
    st ? call('xt', 'GET', `/schools/${o.id}/students/${st.userId}/check-in-code`, tOwner) : { status: '-' },
    call('xt', 'POST', `/schools/${o.id}/front-desk/sessions`, tOwner, {}),
  ]);
  out.cross.push({ school: o.name || o.id.slice(0, 8), codes: rs.map((r) => r.status).join(',') });
}
// my tablet session token against another School's kiosk-free routes
const sess = await call('s', 'POST', `/schools/${S}/front-desk/sessions`, tOwner, { branchId: C.branches[0] });
if (others[0]) out.kioskTokenElsewhere = (await call('xt', 'GET', `/schools/${others[0].id}/students`, sess.body.sessionToken)).status;
fs.writeFileSync(new URL('./pages-result.json', import.meta.url), JSON.stringify({ out, latency: report() }, null, 1));
console.log(JSON.stringify(out, null, 1));
await db.$disconnect();
