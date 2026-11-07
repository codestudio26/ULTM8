// Round 5 JP: Sato-sensei's judo dojo in Tokyo. ~500 people, two Branches, JPY.
// Users, grants, Guardian links and memberships straight into the DB (as round4/world.mjs);
// styles, slots, classes, plans and payment account through the API.
// Writes ./jp-cast.json.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const now = Date.now();
const DAY = 86400e3, YEAR = 365.2425 * DAY;
let rnd = 8181; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const SURN = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水', 'あおき', 'イトウ', '東海林', '長谷川', '五十嵐'];
const GIVEN = ['翔太', '陽菜', 'さくら', '蓮', '結衣', '大翔', '葵', '悠真', '芽依', '湊', 'ひなた', 'ユウキ', '一郎', '花子', '和子', '進', '正雄', 'Haruto', 'Yui'];
const tag = `${now % 1e7}`;
let seq = 0;
const ymd = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
function u(first, surname, dob, extra = {}) {
  const k = seq++;
  return { id: randomUUID(), email: `r5-jp-${tag}-${k}@stress.test`, phone: '+8190' + String(70000000 + (Number(tag) % 900) * 1000 + k).slice(-8),
    firstName: first, surname, passcodeHash: 'x', dateOfBirth: dob, phoneVerifiedAt: new Date(), language: 'ja', currency: 'JPY', ...extra };
}
const age = (y, dayShift = 0) => ymd(new Date(now - y * YEAR + dayShift * DAY));
const exactAge = (years, dayShift) => { const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - years); return ymd(new Date(d.getTime() + dayShift * DAY)); };

// --- School, Branches ---
const school = await db.school.create({ data: {
  id: randomUUID(), name: `R5 JP 佐藤柔道場 ${tag}`, timezone: 'Asia/Tokyo', ranksToggle: true, defaultCurrency: 'JPY', defaultLanguage: 'ja',
  addressCountry: 'JP', addressCity: '東京都', addressPostalCode: '150-0001', waitlistClaimWindowMinutes: 60,
  classCancellationPolicy: 'AUTO_REFUND', cancellationPolicyChosenAt: new Date(), taxCountry: 'JP', taxRateBasisPoints: 1000, taxInclusive: true,
  weekStartsOn: 'SUNDAY',
} });
const branches = [
  await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: '本部道場（渋谷）', addressCountry: 'JP' } }),
  await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: '世田谷支部', addressCountry: 'JP' } }),
];
const [B1, B2] = branches;

// --- Staff ---
const owner = u('翔太', '佐藤', age(58));
const coOwner = u('花子', '佐藤', age(55));
const instrs = [u('正雄', '山下', age(45)), u('葵', '野村', age(33)), u('進', '井上', age(40))];
const deskStaff = [u('結衣', '田中', age(28)), u('蓮', '小林', age(31))];
// --- Special people ---
const special = {
  age95: u('トメ', '長谷川', exactAge(95, -10)),
  age4: u('ひなた', '鈴木', age(4.2)),
  toddler2: u('こはる', '鈴木', age(2.5)),
  turning18soon: u('大翔', '高橋', exactAge(18, 3)),
  turned18yesterday: u('芽依', '高橋', exactAge(18, -1)),
  leap: u('閏', '二月', new Date(Date.UTC(2012, 1, 29))),
  longName: u('寿限無寿限無五劫の擦り切れ海砂利水魚の水行末雲来末風来末食う寝る処に住む処やぶら小路の藪柑子パイポパイポパイポのシューリンガン', 'シューリンガンのグーリンダイグーリンダイのポンポコピーのポンポコナーの長久命の長助じゅげむじゅげむごこうのすりきれ', age(30)),
  mononym: u('ミドリ', '', age(40)),
  romaji: u('Shota', 'Sato', age(35)),
  combining: u('ガ', 'パ', age(36)), // カ + U+3099 combining dakuten, ハ + U+309A
  emoji: u('翔🥋', '佐藤', age(27)),
  medical: u('一郎', '木村', age(72)),
  senior81: u('和子', '渡辺', age(81)),
  staffTrains: u('結衣', '田中-練習', age(28)),
};
special.combining.firstName = 'ガ'; special.combining.surname = 'パ';
const guardians = { mother: u('美咲', '鈴木', age(36)), divorcedA: u('健', '伊藤', age(42)), divorcedB: u('由美', '前田', age(40)), trainingGuardian: u('拓也', '中村', age(39)) };
const gKids = { sib1: u('陽向', '中村', age(8)), sib2: u('凛', '中村', age(11)), divorcedKid: u('悠真', '伊藤', age(9)) };

// --- Bulk members: 470 ---
const bulk = [];
for (let i = 0; i < 470; i++) {
  const r = rand();
  const dob = r < 0.08 ? age(4 + rand() * 3) : r < 0.3 ? age(7 + rand() * 8) : r < 0.42 ? age(15 + rand() * 3) : r < 0.85 ? age(18.5 + rand() * 45) : age(65 + rand() * 25);
  bulk.push(u(pick(GIVEN), pick(SURN), dob, { gender: r < 0.5 ? 'FEMALE' : 'MALE' }));
}
const all = [owner, coOwner, ...instrs, ...deskStaff, ...Object.values(special), ...Object.values(guardians), ...Object.values(gKids), ...bulk];
await db.user.createMany({ data: all });

const students = [...Object.values(special), ...Object.values(gKids), ...bulk, guardians.trainingGuardian];
const bOf = (i) => (i % 3 === 2 ? B2 : B1);
const grants = [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
  ...instrs.map((x, i) => ({ id: randomUUID(), userId: x.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: i === 2 ? B2.id : B1.id })),
  { id: randomUUID(), userId: deskStaff[0].id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: B1.id },
  { id: randomUUID(), userId: deskStaff[1].id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: B2.id },
  ...students.map((s, i) => ({ id: randomUUID(), userId: s.id, role: 'STUDENT', schoolId: school.id, branchId: bOf(i).id })),
  ...Object.values(guardians).map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })),
];
await db.roleGrant.createMany({ data: grants });
await db.instructor.createMany({ data: instrs.map((x, i) => ({ id: randomUUID(), userId: x.id, schoolId: school.id, branchId: i === 2 ? B2.id : B1.id })) });
const links = [
  [guardians.mother, special.age4], [guardians.mother, special.toddler2], [guardians.mother, special.turning18soon],
  [guardians.divorcedA, gKids.divorcedKid], [guardians.divorcedB, gKids.divorcedKid],
  [guardians.trainingGuardian, gKids.sib1], [guardians.trainingGuardian, gKids.sib2],
];
await db.guardianLink.createMany({ data: links.map(([g, k]) => ({ id: randomUUID(), guardianId: g.id, studentId: k.id })) });

const tok = (x, gs) => tokenRca(x, gs);
const tOwner = tok(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
const tStaff1 = tok(deskStaff[0], [grant('BRANCH_STAFF', school.id, B1.id)]);
const tInstr = tok(instrs[0], [grant('INSTRUCTOR', school.id, B1.id)]);

// --- Disciplines, plans, timetable via API ---
const judo = await call('seed', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: '柔道' });
const kids = await call('seed', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: '少年柔道' });
if (judo.status >= 300) throw new Error('disc ' + JSON.stringify(judo.body));
const styles = [{ disciplineId: judo.body.id, classType: null }];
const planDefs = [
  ['SUBSCRIPTION', '月謝（一般）', 880000, {}],
  ['SUBSCRIPTION', '月謝（少年部）', 550000, {}],
  ['CLASS_PACK', '回数券 3回', 100000, { classesIncluded: 3 }],
  ['CLASS_PACK', '回数券 7回', 100000, { classesIncluded: 7 }],
  ['CLASS_PACK', '回数券 10回', 1234500, { classesIncluded: 10, expiryDurationDays: 90 }],
  ['WEEKLY_PASS', '一週間パス', 330000, { expiryDurationDays: 7 }],
  ['TRIAL_MEMBERSHIP', '無料体験', 0, { expiryDurationDays: 14 }],
  ['FRIEND_PASS', '友達パス', 0, { classesIncluded: 1 }],
];
const plans = {};
for (const [type, title, price, extra] of planDefs) {
  const r = await call('seed', 'POST', `/schools/${school.id}/membership-plans`, tOwner, { type, title, price, currency: 'JPY', ...extra });
  if (r.status >= 300) { console.log('plan fail', title, r.status, JSON.stringify(r.body)); continue; }
  plans[title] = r.body.id;
}
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const slots = [];
for (const d of DAYS) for (const [b, i, st, et, title] of [[B1, instrs[0], '06:30', '07:30', '朝稽古'], [B1, instrs[1], '17:00', '18:00', '少年部'], [B1, instrs[0], '19:30', '21:00', '一般部'], [B2, instrs[2], '18:00', '19:30', '世田谷 一般'], [B2, instrs[2], '21:30', '23:59', '深夜稽古']]) {
  const r = await call('seed', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: b.id, instructorId: i.id, weekday: d, startTime: st, endTime: et, title, styles, capacity: title === '少年部' ? 30 : 40 });
  if (r.status >= 300) { console.log('slot fail', title, d, r.status, JSON.stringify(r.body).slice(0, 300)); continue; }
  slots.push(r.body.id);
}
const mkClass = async (title, cap, startOff, len, extra = {}) => {
  const r = await call('seed', 'POST', `/schools/${school.id}/classes`, tOwner, { branchId: B1.id, instructorId: instrs[0].id, title, styles, startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + startOff + len).toISOString(), membershipInclusion: true, capacity: cap, ...extra });
  if (r.status >= 300) throw new Error('class ' + JSON.stringify(r.body));
  return r.body.id;
};
const classes = { soon: await mkClass('特別稽古 A', 40, 3 * DAY, 3600e3), soon2: await mkClass('特別稽古 B', 2, 4 * DAY, 3600e3, { cancellationCharge: 50050 }), now: await mkClass('いま稽古', 40, -10 * 60e3, 3600e3), late: await mkClass('直前稽古', 40, 30 * 60e3, 3600e3, { cancellationCharge: 33333, refundFeeDate: new Date(now - 60e3).toISOString() }) };

// --- Memberships for bulk ---
const ms = [];
bulk.forEach((s, i) => {
  const r = rand(); const base = { id: randomUUID(), studentId: s.id, schoolId: school.id };
  if (r < 0.6) ms.push({ ...base, membershipPlanId: plans['月謝（一般）'], frequency: 'RECURRING' });
  else if (r < 0.75) ms.push({ ...base, membershipPlanId: plans['回数券 10回'], frequency: 'ONE_TIME', classesRemaining: 10 });
});
await db.membership.createMany({ data: ms });

const cast = {
  tag, schoolId: school.id, branches: branches.map((b) => b.id), plans, slots, classes, judo: judo.body.id,
  owner: { id: owner.id, email: owner.email, tok: tOwner }, coOwner: { id: coOwner.id, tok: tok(coOwner, [grant('SCHOOL_OWNER_MANAGER', school.id)]) },
  instr: { id: instrs[0].id, tok: tInstr }, staff1: { id: deskStaff[0].id, tok: tStaff1 }, staff2: { id: deskStaff[1].id, tok: tok(deskStaff[1], [grant('BRANCH_STAFF', school.id, B2.id)]) },
  special: Object.fromEntries(Object.entries(special).map(([k, s]) => [k, { id: s.id, email: s.email, tok: tok(s, [grant('STUDENT', school.id, B1.id)]) }])),
  guardians: Object.fromEntries(Object.entries(guardians).map(([k, g]) => [k, { id: g.id, tok: tok(g, [grant('GUARDIAN', school.id)]) }])),
  gKids: Object.fromEntries(Object.entries(gKids).map(([k, s]) => [k, s.id])),
  bulk: bulk.map((s, i) => ({ id: s.id, tok: tok(s, [grant('STUDENT', school.id, bOf(i + Object.keys(special).length + 3).id)]), plan: ms.find((m) => m.studentId === s.id)?.membershipPlanId ?? null })),
};
fs.writeFileSync(new URL('./jp-cast.json', import.meta.url), JSON.stringify(cast));
console.log({ school: school.id, people: all.length, plans: Object.keys(plans).length, slots: slots.length, memberships: ms.length });
await db.$disconnect();
