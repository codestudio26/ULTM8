// Round 5 AE: Fatima Al-Mansouri's Muay Thai + women-only fitness academy, Dubai and Abu Dhabi.
// Users, grants, Guardian links, memberships straight into the DB (as round4/world.mjs); the rest via API.
// Writes ae-cast.json next to this file.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';
const now = Date.now(); const YEAR = 365.25 * 86400e3; const DAY = 86400e3;
let rnd = 971; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const TAG = 'r5-ae-';
let seq = 0; const phone = () => '+97158' + String(3100000 + seq).padStart(7, '0');
const firstF = ['فاطمة', 'مريم', 'عائشة', 'نورة', 'شما', 'ميثاء', 'Layla', 'Hessa', 'Aisha', 'Reem', 'سارة', 'Priya', 'Maria'];
const firstM = ['محمد', 'عبد الله', 'خالد', 'سيف', 'Omar', 'Rashid', 'Hamdan', 'John', 'Arjun'];
const lastA = ['المنصوري', 'Al-Mansouri', 'بن راشد', 'آل نهيان', 'الكعبي', 'Al Suwaidi', 'بنت سعيد الظاهري', 'bin Zayed', 'الشامسي', "D'Souza", 'Fernandes'];
const people = [];
function mk(p) {
  const k = seq++;
  const u = { id: randomUUID(), email: `${TAG}${k}@stress.test`, phone: phone(), firstName: p.first, surname: p.last, passcodeHash: 'x',
    dateOfBirth: p.dob, phoneVerifiedAt: new Date(), language: p.lang ?? 'ar', currency: 'AED', gender: p.gender ?? null, addressCountry: 'AE' };
  people.push(u); return u;
}
const ageDob = (y, extraDays = 0) => new Date(now - y * YEAR + extraDays * DAY);
const dobExact = (s) => new Date(s + 'T00:00:00Z');
// ---- School + Branches (DB, like world.mjs) ----
const school = await db.school.create({ data: { id: randomUUID(), name: 'R5 AE أكاديمية الأمل للمواي تاي', timezone: 'Asia/Dubai', ranksToggle: true,
  defaultCurrency: 'AED', defaultLanguage: 'ar', addressCountry: 'AE', addressCity: 'دبي', addressLine1: 'شارع الشيخ زايد، القوز 3',
  waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), taxCountry: 'AE', taxRateBasisPoints: 500, taxInclusive: true, weekStartsOn: 'MONDAY' } });
const brDubai = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'فرع دبي - القوز', addressCountry: 'AE', addressCity: 'Dubai' } });
const brAbu = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Abu Dhabi فرع أبوظبي 2', addressCountry: 'AE', addressCity: 'Abu Dhabi' } });
const branches = [brDubai, brAbu];
// ---- Staff ----
const owner = mk({ first: 'فاطمة', last: 'Al-Mansouri المنصوري', gender: 'FEMALE', dob: ageDob(41) });
const coOwner = mk({ first: 'حصة', last: 'بنت محمد الكعبي', gender: 'FEMALE', dob: ageDob(38) });
const instrs = [mk({ first: 'Saeed', last: 'bin Rashid', gender: 'MALE', dob: ageDob(33) }), mk({ first: 'نورة', last: 'الشامسي', gender: 'FEMALE', dob: ageDob(29) }),
  mk({ first: 'Kru', last: 'Somchai', gender: 'MALE', dob: ageDob(45), lang: 'th' }), mk({ first: 'ريم', last: 'Al Suwaidi 2', gender: 'FEMALE', dob: ageDob(27) })];
const staffDubai = mk({ first: 'مريم', last: 'الظاهري', gender: 'FEMALE', dob: ageDob(24) });
const staffAbu = mk({ first: 'Aisha', last: 'Al Dhaheri عائشة', gender: 'FEMALE', dob: ageDob(26) });
// ---- Special people ----
const sp = {};
sp.toddler = mk({ first: 'شما', last: 'المنصوري', gender: 'FEMALE', dob: ageDob(3) });
sp.kid1 = mk({ first: 'سيف', last: 'بن خالد الكعبي', gender: 'MALE', dob: ageDob(7) });
sp.kid2 = mk({ first: 'ميثاء', last: 'بنت خالد الكعبي', gender: 'FEMALE', dob: ageDob(9) });
sp.kidDivorced = mk({ first: 'Hamdan', last: 'Al-Mansouri', gender: 'MALE', dob: ageDob(11) });
sp.teen = mk({ first: 'عائشة', last: 'بنت سعيد', gender: 'FEMALE', dob: ageDob(15) });
sp.turning18 = mk({ first: 'نورة', last: 'بنت راشد', gender: 'FEMALE', dob: new Date(Date.UTC(new Date(now).getUTCFullYear() - 18, new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 3)) });
sp.turned18 = mk({ first: 'خالد', last: 'بن سيف', gender: 'MALE', dob: new Date(Date.UTC(new Date(now).getUTCFullYear() - 18, new Date(now).getUTCMonth(), new Date(now).getUTCDate() - 1)) });
sp.senior70 = mk({ first: 'Maria', last: 'Fernandes', gender: 'FEMALE', dob: ageDob(72) });
sp.senior95 = mk({ first: 'موزة', last: 'بنت حمد', gender: 'FEMALE', dob: ageDob(95) });
sp.disabled = mk({ first: 'ريم', last: 'الحمادي', gender: 'FEMALE', dob: ageDob(30) });
sp.leap = mk({ first: 'Layla', last: 'Feb29', gender: 'FEMALE', dob: dobExact('2008-02-29') });
sp.longName = mk({ first: 'عبد الرحمن محمد عبد الله سعيد راشد حمد', last: 'بن خليفة بن زايد بن سلطان بن محمد آل نهيان المنصوري الكعبي الشامسي الظاهري السويدي'.padEnd(110, 'ي'), gender: 'MALE', dob: ageDob(35) });
sp.mono = mk({ first: 'Priya', last: '-', gender: 'FEMALE', dob: ageDob(31) });
sp.bidi = mk({ first: 'فاطمة 2nd', last: 'Al-Mansouri المنصوري 3', gender: 'FEMALE', dob: ageDob(28) });
sp.rlm = mk({ first: '‏مريم‏', last: '‫النعيمي‬', gender: 'FEMALE', dob: ageDob(26) });
sp.emoji = mk({ first: 'نورة 🥊', last: 'الكتبي ✨', gender: 'FEMALE', dob: ageDob(22) });
sp.diacritics = mk({ first: 'مُحَمَّد', last: 'الْمَنْصُورِي', gender: 'MALE', dob: ageDob(40) });
sp.apos = mk({ first: "Shaun", last: "D'Souza-O'Neil", gender: 'MALE', dob: ageDob(37) });
// Guardians
const gMother = mk({ first: 'هند', last: 'الكعبي', gender: 'FEMALE', dob: ageDob(38) }); // siblings kid1+kid2, also trains
const gDad = mk({ first: 'Rashid', last: 'Al-Mansouri', gender: 'MALE', dob: ageDob(44) }); // divorced parent 1
const gMum2 = mk({ first: 'Sara', last: 'Haddad سارة', gender: 'FEMALE', dob: ageDob(40) }); // divorced parent 2
const gToddler = owner; // Fatima is toddler's mother
// Bulk members: ~560, 75% female (women-only fitness).
const bulk = [];
for (let i = 0; i < 560; i++) {
  const r = rand(); const female = rand() < 0.75;
  const dob = r < 0.18 ? ageDob(5 + rand() * 11) : r < 0.22 ? ageDob(16 + rand() * 2) : ageDob(18.2 + rand() * 45);
  bulk.push(mk({ first: pick(female ? firstF : firstM), last: pick(lastA), gender: female ? 'FEMALE' : 'MALE', dob }));
}
for (let i = 0; i < people.length; i += 500) await db.user.createMany({ data: people.slice(i, i + 500) });
const students = [...Object.values(sp), gMother, ...bulk, instrs[1]];
const branchOf = (u, i) => (i % 3 === 2 ? brAbu : brDubai);
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
  ...instrs.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[i % 2].id })),
  { id: randomUUID(), userId: staffDubai.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: brDubai.id },
  { id: randomUUID(), userId: staffAbu.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: brAbu.id },
  ...students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id, branchId: branchOf(u, i).id })),
  ...[gMother, gDad, gMum2, owner].map((u) => ({ id: randomUUID(), userId: u.id, role: 'GUARDIAN', schoolId: school.id })),
] });
await db.instructor.createMany({ data: instrs.map((u, i) => ({ id: randomUUID(), userId: u.id, schoolId: school.id, branchId: branches[i % 2].id })) });
// Guardian links: siblings, divorced parents (two guardians), toddler; minors in bulk get the mother.
const minors = bulk.filter((u) => now - u.dateOfBirth.getTime() < 18 * YEAR);
const links = [[gMother, sp.kid1], [gMother, sp.kid2], [gDad, sp.kidDivorced], [gMum2, sp.kidDivorced], [owner, sp.toddler], [gMum2, sp.teen], [gDad, sp.turning18],
  ...minors.map((k, i) => [[gMother, gDad, gMum2][i % 3], k])];
await db.guardianLink.createMany({ data: links.map(([g, k]) => ({ id: randomUUID(), guardianId: g.id, studentId: k.id })) });
const T = (u, role, branchId = null) => tokenRca(u, [grant(role, school.id, branchId)], 0);
const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)], 0);
// ---- Disciplines, timetable through the API ----
const disc = await call('seed:style', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: 'مواي تاي Muay Thai' });
const disc2 = await call('seed:style2', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: 'لياقة نسائية' });
console.log('disciplines', disc.status, disc2.status, JSON.stringify(disc.body).slice(0, 200));
const styles = [{ disciplineId: disc.body.id, classType: (disc.body.classTypesOffered || [])[0] ?? null }];
const styles2 = [{ disciplineId: disc2.body.id, classType: (disc2.body.classTypesOffered || [])[0] ?? null }];
const slotDefs = [
  ['MONDAY', '18:00', '19:30', brDubai, instrs[0], 'مواي تاي للمبتدئين', styles], ['MONDAY', '10:00', '11:00', brDubai, instrs[0], 'لياقة للسيدات فقط (Ladies only)', styles2],
  ['TUESDAY', '19:00', '20:30', brDubai, instrs[0], 'Muay Thai Advanced متقدم', styles], ['WEDNESDAY', '17:00', '18:00', brDubai, instrs[0], 'مواي تاي للأطفال 6-12', styles],
  ['THURSDAY', '20:00', '21:30', brDubai, instrs[0], 'Sparring نزال', styles], ['FRIDAY', '09:00', '10:30', brDubai, instrs[0], 'جمعة صباحية', styles],
  ['FRIDAY', '16:00', '17:30', brDubai, instrs[0], 'بعد صلاة الجمعة', styles], ['SATURDAY', '10:00', '11:30', brDubai, instrs[0], 'Weekend Open Mat', styles],
  ['SUNDAY', '23:00', '00:30', brDubai, instrs[0], 'Late night قبل منتصف الليل', styles],
  ['MONDAY', '19:00', '20:00', brAbu, instrs[1], 'لياقة السيدات - أبوظبي', styles2], ['WEDNESDAY', '19:00', '20:30', brAbu, instrs[1], 'مواي تاي أبوظبي', styles],
  ['SATURDAY', '11:00', '12:00', brAbu, instrs[1], 'Kids أطفال', styles],
];
const slots = [];
for (const [d, s, e, b, ins, title, st] of slotDefs) {
  const r = await call('seed:slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: b.id, instructorId: ins.id, weekday: d, startTime: s, endTime: e, title, styles: st, capacity: 20, membershipInclusion: true });
  slots.push({ id: r.body?.id, status: r.status, title, err: r.status >= 300 ? r.body : undefined });
}
console.log('slots', slots.map((s) => s.status).join(','), slots.filter((s) => s.err).map((s) => JSON.stringify(s.err)).join(' | '));
// ---- Plans in AED (hundredths), DB like world.mjs ----
const plan = (type, title, aed, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: Math.round(aed * 100), currency: 'AED', ...extra });
const plans = [plan('SUBSCRIPTION', 'اشتراك شهري غير محدود', 650), plan('CLASS_PACK', 'باقة 10 حصص', 900, { classesIncluded: 10, expiryDurationDays: 90 }),
  plan('CLASS_PACK', 'Ladies 5-pack باقة السيدات', 425.5, { classesIncluded: 5 }), plan('WEEKLY_PASS', 'تذكرة أسبوعية Week pass', 199, { expiryDurationDays: 7 }),
  plan('TRIAL_MEMBERSHIP', 'حصة تجريبية مجانية', 0, { expiryDurationDays: 7 }), plan('CLASS_PACK', 'Ramadan رمضان pack 1447', 313, { classesIncluded: 8, expiryDurationDays: 30 })];
await db.membershipPlan.createMany({ data: plans });
const ms = students.map((u, i) => {
  const r = rand(); const base = { id: randomUUID(), studentId: u.id, schoolId: school.id };
  return r < 0.6 ? { ...base, membershipPlanId: plans[0].id, frequency: 'RECURRING' } : r < 0.85 ? { ...base, membershipPlanId: plans[1].id, frequency: 'ONE_TIME', classesRemaining: 10, expiryDate: new Date(now + 60 * DAY) } : null;
}).filter(Boolean);
await db.membership.createMany({ data: ms });
const user = (u) => ({ id: u.id, email: u.email });
const cast = { school: school.id, branches: { dubai: brDubai.id, abu: brAbu.id }, styles, styles2, slots, plans: Object.fromEntries(plans.map((p) => [p.title, p.id])),
  owner: user(owner), coOwner: user(coOwner), instrs: instrs.map(user), staffDubai: user(staffDubai), staffAbu: user(staffAbu),
  sp: Object.fromEntries(Object.entries(sp).map(([k, u]) => [k, user(u)])), gMother: user(gMother), gDad: user(gDad), gMum2: user(gMum2),
  students: students.map((u, i) => ({ ...user(u), branch: branchOf(u, i).id })), counts: { people: people.length, students: students.length, minors: minors.length, memberships: ms.length } };
fs.writeFileSync(new URL('./ae-cast.json', import.meta.url), JSON.stringify(cast, null, 1));
console.log(cast.counts, school.id);
await db.$disconnect();
