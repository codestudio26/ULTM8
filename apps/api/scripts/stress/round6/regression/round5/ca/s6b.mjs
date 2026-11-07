import { C, call, db, FAKE, sleep, note } from './lib-ca.mjs';
const before = await db.membershipPlanPriceChange.count({ where: { membershipPlanId: C.plans.monthly } });
const fb = await (await fetch(`${FAKE}/__calls`)).json();
const rs = await Promise.all([1,2,3,4,5].map(() => call('p','PATCH',`/membership-plans/${C.plans.monthly}`, C.owner.tok, { price: 21900, priceChangeStrategy: 'MIGRATE' })));
await sleep(8000);
const fa = await (await fetch(`${FAKE}/__calls`)).json();
const rows = await db.membershipPlanPriceChange.findMany({ where: { membershipPlanId: C.plans.monthly }, orderBy: { createdAt: 'desc' }, take: 6 });
note('codes', rs.map(r=>r.status), 'new rows', (await db.membershipPlanPriceChange.count({ where: { membershipPlanId: C.plans.monthly } })) - before, rows.slice(0,5).map(r=>`${r.decision} ${r.oldPrice}->${r.newPrice} ${r.status} n=${r.affectedMembershipCount}`), 'prices created', (fa['POST /v1/prices']||0)-(fb['POST /v1/prices']||0), 'products', (fa['POST /v1/products']||0)-(fb['POST /v1/products']||0));
await db.$disconnect();
