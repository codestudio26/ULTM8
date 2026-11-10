// Round 7 R: what a paused Branch Staff member and a member get from the
// School's everyday staff pages (Decision 449 item 6), beyond the switch-gated ones.
import fs from 'fs';
import { call, signIn } from '../../../rehearsal/lib.mjs';
const cast = JSON.parse(fs.readFileSync(process.argv[2]));
const c = cast[process.argv[3] || 'A'], sid = c.schoolId;
for (const k of ['owner', 'staff', 'adult']) await signIn(c[k]);
const pages = ['', '/students', '/branches', '/staff', '/membership-plans', '/charge-reports/overview', '/transactions', '/classes', '/timetable-slots', '/waivers', '/notifications', '/sign-ups', '/check-in-rules', `/students/${c.adult.id}`];
const run = async (who) => { const o = []; for (const p of pages) { const r = await call('GET', `/schools/${sid}${p}`, c[who].tok); o.push(`${p || '/'} ${r.status} ${r.body?.error?.code ?? ''}`); } return o; };
const before = await run('staff');
await call('POST', `/schools/${sid}/staff/${c.staff.id}/pause`, c.owner.tok, {});
await signIn(c.staff);
const paused = await run('staff');
await call('POST', `/schools/${sid}/staff/${c.staff.id}/unpause`, c.owner.tok, {});
const member = await run('adult');
console.log(pages.map((p, i) => `${(p || '/').padEnd(28)} staff: ${before[i].split(' ').slice(1).join(' ').padEnd(24)} paused: ${paused[i].split(' ').slice(1).join(' ').padEnd(24)} member: ${member[i].split(' ').slice(1).join(' ')}`).join('\n'));
