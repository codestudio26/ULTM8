// T7: Arabic name search: harakat, ta marbuta/ha, hamza on alef, Arabic-Indic digits, mixed-script.
import { C, tk, call, S, short, db, checks } from './lib.mjs';
const { ok, save } = checks('t7-search');
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const q = async (s) => { const r = await call('t7:search', 'GET', `/schools/${S}/students?search=${encodeURIComponent(s)}`, tOwner); return { status: r.status, names: (r.body?.items ?? []).map((x) => `${x.firstName} ${x.surname}`) }; };
const cases = [
  ['محمد', 'مُحَمَّد', 'harakat: typed without, stored with'],
  ['عائشه', 'عائشة', 'ta marbuta typed as ha'],
  ['فاطمه', 'فاطمة', 'ta marbuta typed as ha'],
  ['المنصورى', 'المنصوري', 'final ya typed as alef maqsura'],
  ['فـاطمة', 'فاطمة', 'tatweel in query'],
  ['Al Mansouri', 'Al-Mansouri', 'hyphen vs space'],
  ['al-mansouri', 'Al-Mansouri', 'case-insensitive Latin'],
  ['فاطمة Al', 'فاطمة 2nd', 'mixed script first+surname'],
];
for (const [query, expect, why] of cases) {
  const r = await q(query);
  ok(`T7 "${query}" finds "${expect}" (${why})`, r.status === 200 && r.names.some((n) => n.includes(expect)), `${r.status} ${r.names.length} hits ${short(r.names.slice(0, 3), 140)}`);
}
save(); await db.$disconnect();
