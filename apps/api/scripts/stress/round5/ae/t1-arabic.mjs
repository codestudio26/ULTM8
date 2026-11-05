// T1: Arabic/RTL text through the API: School, Branch, class, plan, waiver, broadcast, export CSV, signed-document PDF.
import { C, tk, call, S, short, db, checks } from './lib.mjs';
import fs from 'fs';
const { ok, save } = checks('t1-arabic');
const tOwner = tk(C.owner, 'SCHOOL_OWNER_MANAGER');
const AR_SCHOOL = 'R5 AE أكاديمية الأمل للمواي تاي واللياقة النسائية — دبي ٢';
const p = await call('t1:school-patch', 'PATCH', `/schools/${S}`, tOwner, { name: AR_SCHOOL });
const g = await call('t1:school-get', 'GET', `/schools/${S}`, tOwner);
ok('T1a School name in Arabic with Arabic-Indic digit round-trips', p.status < 300 && g.body?.name === AR_SCHOOL, `${p.status} ${short(p.body?.name ?? p.body, 200)}`);
const br = await call('t1:branch-patch', 'PATCH', `/branches/${C.branches.abu}`, tOwner, { name: 'فرع أبوظبي — Khalifa City مدينة خليفة 2' });
ok('T1b Branch name mixed Arabic/Latin/digits', br.status < 300, `${br.status} ${short(br.body, 200)}`);
// One-off class with Arabic title, description with bidi.
const start = new Date(Date.now() + 3 * 86400e3); start.setUTCHours(15, 0, 0, 0);
const cls = await call('t1:class', 'POST', `/schools/${S}/classes`, tOwner, { branchId: C.branches.dubai, instructorId: C.instrs[0].id, title: 'ورشة المواي تاي مع Kru Somchai (٣ ساعات)', description: 'للمستوى المتوسط فما فوق. Bring gloves 12oz.\nالرسوم 150 د.إ', styles: C.styles, startDate: start.toISOString(), endDate: new Date(start.getTime() + 3 * 3600e3).toISOString(), capacity: 15, membershipInclusion: true });
ok('T1c one-off class with Arabic title', cls.status === 201, `${cls.status} ${short(cls.body?.title ?? cls.body, 200)}`);
C.workshop = cls.body?.id;
// Waiver in Arabic.
const wv = await call('t1:waiver', 'POST', `/schools/${S}/waivers`, tOwner, { title: 'إقرار المسؤولية والتنازل', body: 'أقر أنا الموقع/ة أدناه بأن رياضة المواي تاي رياضة احتكاكية قد تسبب إصابات.\nأوافق على الالتزام بقواعد الأكاديمية (القاعدة رقم 7) وعلى أن الحصص النسائية مخصصة للسيدات فقط.\nI agree that photos may be taken — أوافق على التصوير.' });
ok('T1d Arabic waiver created', wv.status === 201, `${wv.status} ${short(wv.body, 200)}`);
C.waiver = wv.body?.id;
// Adult signs in Arabic (typed signature with RLM).
const adult = C.sp.bidi;
const sign = await call('t1:sign', 'POST', `/waivers/${C.waiver}/sign`, tk(adult, 'STUDENT', C.branches.dubai), { signerFullName: 'فاطمة 2nd Al-Mansouri المنصوري 3', signatureText: '‏فاطمة المنصوري' });
ok('T1e adult signs Arabic waiver with Arabic typed signature', sign.status < 300, `${sign.status} ${short(sign.body, 200)}`);
// Guardian signs for a minor.
const gs = await call('t1:sign-guardian', 'POST', `/waivers/${C.waiver}/sign`, tk(C.gMother, 'GUARDIAN'), { studentId: C.sp.kid1.id, signerFullName: 'هند الكعبي', signatureText: 'هند' });
ok('T1f Guardian signs for minor', gs.status < 300, `${gs.status} ${short(gs.body, 200)}`);
// Students export (CSV?) with Arabic.
const ex = await fetch(`${process.env.API}/schools/${S}/students/export`, { headers: { authorization: 'Bearer ' + tOwner } });
const buf = Buffer.from(await ex.arrayBuffer());

const txt = buf.toString('utf8');
ok('T1g students export keeps Arabic names (UTF-8)', ex.status === 200 && txt.includes('المنصوري'), `${ex.status} ${ex.headers.get('content-type')} bom=${buf[0] === 0xef} bytes=${buf.length} sample=${short(txt.slice(0, 300))}`);
// Signed documents export (zip with PDFs).
const labels = { member: 'العضو', document: 'المستند', version: 'الإصدار', signedAt: 'وقت التوقيع', signedBy: 'وقّع باسم', file: 'الملف', guardian: 'ولي الأمر', onPaper: 'ورقي', guest: 'ضيف' };
const se = await call('t1:sd-export', 'POST', `/schools/${S}/signed-documents/exports`, tOwner, { labels });
ok('T1h signed-document export starts', se.status < 300, `${se.status} ${short(se.body, 300)}`);
C.sdExport = se.body?.id ?? se.body?.exportId;
// Broadcast in Arabic.
const bc = await call('t1:broadcast', 'POST', `/schools/${S}/notifications/broadcast`, tOwner, { title: 'رمضان كريم 🌙 — جدول رمضان', body: 'تبدأ حصص رمضان بعد الإفطار الساعة 9:00 مساءً. Eid closure: ١ - ٣ شوال.', audience: 'BRANCH', branchId: C.branches.dubai });
ok('T1i Arabic broadcast to Dubai Branch', bc.status < 300, `${bc.status} ${short(bc.body, 200)}`);
// Plan created through API with Arabic title.
const pl = await call('t1:plan', 'POST', `/schools/${S}/membership-plans`, tOwner, { type: 'CLASS_PACK', title: 'باقة رمضان ٨ حصص', price: 31300, currency: 'AED', classesIncluded: 8, expiryDurationDays: 30 });
ok('T1j Arabic plan via API', pl.status < 300, `${pl.status} ${short(pl.body, 300)}`);
// Search by Arabic, with and without diacritics and alef variants.
const s1 = await call('t1:search', 'GET', `/schools/${S}/students?search=${encodeURIComponent('محمد')}`, tOwner);
const s2 = await call('t1:search-alef', 'GET', `/schools/${S}/students?search=${encodeURIComponent('المنصوري')}`, tOwner);
const items = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const names = (b) => items(b).map((x) => `${x.firstName ?? x.user?.firstName} ${x.surname ?? x.user?.surname}`);
const diac = names(s1.body).some((n) => n.includes('مُحَمَّد'));
ok('T1k searching "محمد" also finds "مُحَمَّد" (with harakat)', diac, `${s1.status} ${items(s1.body).length} hits; diacritic name found=${diac}; keys=${short(Object.keys(s1.body || {}))}`);
fs.writeFileSync(new URL('./ae-cast.json', import.meta.url), JSON.stringify(C, null, 1));
save(); await db.$disconnect();
