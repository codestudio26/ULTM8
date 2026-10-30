// Round 4, phase 5: how far one API instance goes. A mix of what members'
// phones and owners' screens ask for all day (members: my bookings, my
// memberships, my notices, a School's timetable; owners: dashboard, classes,
// staff), at rising numbers of requests in flight, STEP_S seconds each.
// Stops when p95 passes 3 s or more than 1% fail. ramp-result.json.
import { call, cast, stats } from './common.mjs';
const LEVELS = (process.env.LEVELS || '16,32,64,128,256,512').split(',').map(Number);
const STEP_S = +(process.env.STEP_S || 20);
const members = cast.schools.flatMap((s) => s.students.filter((_, i) => i % 7 === 0).map((st) => ({ s, st })));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const one = (k) => {
  const r = Math.random();
  if (r < 0.8) {
    const { s, st } = pick(members);
    const m = ['bookings/me', 'memberships/me', 'notifications/me', `schools/${s.id}/timetable`][Math.floor(Math.random() * 4)];
    return call(`ramp:${k}`, 'GET', `/${m}`, st.tok);
  }
  const s = pick(cast.schools);
  return call(`ramp:${k}`, 'GET', pick([`/schools/${s.id}/dashboard`, `/schools/${s.id}/classes`, `/schools/${s.id}/staff`]), s.owner.tok);
};
const out = [];
for (const c of LEVELS) {
  const k = String(c).padStart(4, '0');
  const end = Date.now() + STEP_S * 1000;
  await Promise.all(Array.from({ length: c }, async () => { while (Date.now() < end) await one(k); }));
  const s = stats[`ramp:${k}`]; const a = s.ms.slice().sort((x, y) => x - y); const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))] | 0;
  const bad = Object.entries(s.codes).filter(([code]) => +code >= 500 || +code === 0 || code === 'ERR').reduce((n, [, v]) => n + v, 0);
  const row = { inFlight: c, perSecond: Math.round(s.n / STEP_S), p50: q(0.5), p95: q(0.95), p99: q(0.99), failedPct: +(100 * bad / s.n).toFixed(2), codes: s.codes };
  out.push(row); console.log(JSON.stringify(row));
  if (row.p95 > 3000 || row.failedPct > 1) break;
}
(await import('fs')).writeFileSync(new URL('./ramp-result.json', import.meta.url), JSON.stringify(out, null, 1));
process.exit(0);
