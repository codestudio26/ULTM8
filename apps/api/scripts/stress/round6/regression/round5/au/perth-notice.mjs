// A Perth class cancelled: is the notice's time Perth's clock (+08:00) or Sydney's (+11:00)?
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const A = JSON.parse(fs.readFileSync(new URL('./cast-au.json', import.meta.url)));
const sid = A.schoolId;
const owner = tokenRca({ id: A.owner, email: 'o' }, [grant('SCHOOL_OWNER_MANAGER', sid)]);
const cls = await db.class.findFirst({ where: { schoolId: sid, branchId: A.branches.per, title: 'BJJ Perth', cancelledAt: null, startDate: { gt: new Date() } }, orderBy: { startDate: 'asc' } });
const s = A.students.find((x) => x.b === 'per' && x.tag === 'adult' && A.memberships[x.id] && x.id !== A.students[0].id);
const st = tokenRca({ id: s.id, email: 's' }, [grant('STUDENT', sid, A.branches.per)]);
const b = await call('pn', 'POST', `/classes/${cls.id}/book`, st, {});
const c = await call('pn', 'POST', `/classes/${cls.id}/cancel`, owner, { reason: 'Perth gym flooded' });
await new Promise((r) => setTimeout(r, 6000));
const n = await db.notification.findFirst({ where: { userId: s.id, body: { contains: 'Perth gym flooded' } }, select: { body: true } });
const fmt = (tz) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(cls.startDate);
console.log('class starts', cls.startDate.toISOString(), '| Perth', fmt('Australia/Perth'), '| Sydney', fmt('Australia/Sydney'));
console.log('book', b.status, 'cancel', c.status, 'notice:', n?.body);
await db.$disconnect();
