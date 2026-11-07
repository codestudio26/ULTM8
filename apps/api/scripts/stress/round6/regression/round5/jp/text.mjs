// Japanese text: search, order, Friend Pass gift.
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./jp-cast.json', import.meta.url)));
const S = C.schoolId, O = C.owner.tok;
const q = async (s) => { const r = await call('t', 'GET', `/schools/${S}/students?search=${encodeURIComponent(s)}`, O); const items = Array.isArray(r.body) ? r.body : r.body.items ?? r.body.data ?? []; return { status: r.status, n: items.length, names: items.slice(0, 3).map((x) => `${x.surname ?? x.student?.surname}|${x.firstName ?? x.student?.firstName}`) }; };
for (const s of ['佐藤', '翔太', '翔太 佐藤', '佐藤 翔太', '佐藤　翔太', '佐藤翔太', 'さとう', 'ｲﾄｳ', 'イトウ', 'ガ', 'ガ', 'ﾐﾄﾞﾘ', 'ミドリ', 'Sato', 'SATO', "' OR 1=1 --", '%', '寿限無']) console.log(JSON.stringify(s), JSON.stringify(await q(s)));
const all = await call('t', 'GET', `/schools/${S}/students`, O);
const items = Array.isArray(all.body) ? all.body : all.body.items ?? [];
console.log('roster', all.status, items.length, 'first 12 surnames in API order:', items.slice(0, 12).map((x) => x.surname ?? x.student?.surname).join(' / '));
console.log('keys', Object.keys(items[0] ?? {}).join(','));
// Friend Pass gift
const st = C.bulk[11];
const g = await call('t', 'POST', `/schools/${S}/students/${st.id}/memberships/gift`, O, { membershipPlanId: C.plans['友達パス'] });
console.log('gift friend pass', g.status, JSON.stringify(g.body).slice(0, 200));
const g5 = await Promise.all(Array.from({ length: 5 }, () => call('t', 'POST', `/schools/${S}/students/${C.bulk[12].id}/memberships/gift`, O, { membershipPlanId: C.plans['友達パス'] })));
console.log('gift x5 codes', g5.map((r) => r.status).join(','), 'memberships', await db.membership.count({ where: { studentId: C.bulk[12].id, membershipPlanId: C.plans['友達パス'] } }));
const fp = await call('t', 'POST', `/schools/${S}/membership-plans`, O, { type: 'FRIEND_PASS', title: '有料友達パス', price: 100000, currency: 'JPY', classesIncluded: 1 });
console.log('paid friend pass plan', fp.status, JSON.stringify(fp.body).slice(0, 200));
const tx = await db.transaction.count({ where: { studentId: { in: [st.id, C.bulk[12].id] } } });
console.log('transactions for gift receivers', tx);
await db.$disconnect();
