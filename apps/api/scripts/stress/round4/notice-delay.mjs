// Round 4: how long an urgent notice (a waitlist seat offer) takes to reach the
// member while the notification queue holds a bulk backlog (broadcasts, a new
// waiver at every School). Run it right after life.mjs. notice-delay-result.json.
import fs from 'fs';
import { db, call, cast } from './common.mjs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const IORedis = require('ioredis');
const redis = new IORedis(process.env.REDIS_URL);
const backlog = await redis.llen('bull:notification-fanout:wait');
const s = cast.schools.find((x) => x.size === 'medium' && x.n > 400);
const [a, b] = s.students.filter((x) => x.kind === 'sub' && x.branch === s.branches[0]);
const start = new Date(Date.now() + 3 * 86400e3);
const cls = await call('nd:class', 'POST', `/schools/${s.id}/classes`, s.owner.tok, { branchId: s.branches[0], instructorId: s.instructors[0], title: 'One seat', styles: [{ disciplineId: s.disciplineId, classType: s.classType }], startDate: start.toISOString(), endDate: new Date(start.getTime() + 3600e3).toISOString(), membershipInclusion: true, capacity: 1 });
const bk = await call('nd:book', 'POST', `/classes/${cls.body.id}/book`, a.tok, {});
const wl = await call('nd:waitlist', 'POST', `/classes/${cls.body.id}/waitlist`, b.tok, {});
if (cls.status >= 300 || bk.status >= 300 || wl.status >= 300) { console.log('setup failed', cls.body, bk.body, wl.body); process.exit(1); }
const entry = await db.waitlistEntry.findFirst({ where: { classId: cls.body.id, studentId: b.id } });
const noticeId = `waitlist-notified-${entry.id}`;
const t0 = Date.now();
const cancel = await call('nd:cancel', 'PATCH', `/bookings/${bk.body.id}/cancel`, a.tok, {});
let ms = null;
while (Date.now() - t0 < Number(process.env.WAIT_MS || 600e3)) {
  if (await db.notification.findUnique({ where: { id: noticeId } })) { ms = Date.now() - t0; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
const result = { backlogAtStart: backlog, class: cls.status, book: bk.status, waitlist: wl.status, cancel: cancel.status, seatOfferArrivedAfterSeconds: ms === null ? `>${Number(process.env.WAIT_MS || 600e3) / 1000} (gave up)` : ms / 1000, claimWindowMinutes: 60 };
console.log(result);
fs.writeFileSync(new URL('./notice-delay-result.json', import.meta.url), JSON.stringify(result, null, 1));
await redis.quit(); await db.$disconnect();
