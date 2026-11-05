// T8: class cancelled → both divorced parents get the child's notice, nobody else's Guardian does.
import { C, tk, call, S, short, db, checks } from './lib.mjs';
const { ok, save } = checks('t8-notices');
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const cls = await db.class.findFirst({ where: { schoolId: S, branchId: C.branches.dubai, cancelledAt: null, startDate: { gt: new Date(Date.now() + 2 * 86400e3) } }, orderBy: { startDate: 'asc' } });
const b = await call('t8:owner-books-kid', 'POST', `/classes/${cls.id}/book`, tOwner, { studentId: C.sp.kidDivorced.id });
const since = new Date();
const c = await call('t8:cancel', 'POST', `/classes/${cls.id}/cancel`, tOwner, { reason: 'صيانة الصالة' });
await new Promise((r) => setTimeout(r, 6000));
const nn = async (u) => db.notification.findMany({ where: { userId: u.id, createdAt: { gt: since } }, select: { title: true, body: true } });
const [dad, mum2, mother, kid] = await Promise.all([nn(C.gDad), nn(C.gMum2), nn(C.gMother), nn(C.sp.kidDivorced)]);
const about = (l) => l.some((x) => x.body.includes('صيانة الصالة'));
ok('T8a Hamdan, his father and his mother are told; another family\'s Guardian is not', about(kid) && about(dad) && about(mum2) && !about(mother), `book ${b.status} cancel ${c.status}; kid=${about(kid)} dad=${about(dad)} mum2=${about(mum2)} other=${about(mother)}; dad got: ${short(dad[0]?.body, 200)}`);
save(); await db.$disconnect();
