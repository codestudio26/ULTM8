// Round 5, AU: Jack Nguyen's BJJ & Boxing academy. Sydney (school zone), Perth
// and Lord Howe Island Branches. Users, grants, guardian links and memberships go
// straight into the DB (as round4/world.mjs); disciplines, slots, classes via the API.
// Writes ./cast-au.json.
//   CAST=../empty-cast.json node seed.mjs
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const now = Date.now();
const DAY = 86400e3, YEAR = 365.25 * DAY;
let rnd = 61; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const FIRST = ['Jack', 'Olivia', 'Liam', 'Charlotte', 'Noah', 'Mia', 'Thanh', 'Linh', 'Wei', 'Priya', 'Aroha', 'Jarrah', 'Kirra', 'Mai', 'Duc', 'Zoë', 'Siobhán', 'Matilda', 'Harper', 'Cooper'];
const LAST = ['Nguyen', 'Smith', 'Tran', "O'Connor", 'Williams', 'Le', 'Pham', 'Brown', 'Kelly-Watson', 'Wilson', 'Chen', 'Taylor', 'Singh', 'Papadopoulos', 'Murray'];
let seq = 0;
const phone = (k) => '+614' + String(10000000 + k).slice(-8);
const mk = (dob, extra = {}) => {
  const k = seq++;
  return { id: randomUUID(), email: `r5-au-${k}@stress.test`, phone: phone(k + 70000), firstName: pick(FIRST), surname: pick(LAST), passcodeHash: 'x',
    dateOfBirth: dob, phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'AUD', gender: rand() < 0.45 ? 'FEMALE' : 'MALE', ...extra };
};
const ageDob = (years) => new Date(now - years * YEAR);
const users = [];
const add = (u, tag) => { u._tag = tag; users.push(u); return u; };

const school = await db.school.create({ data: {
  id: randomUUID(), name: "R5 AU Jack's BJJ & Boxing", timezone: 'Australia/Sydney', ranksToggle: true, defaultCurrency: 'AUD', defaultLanguage: 'en-GB',
  addressCountry: 'AU', addressLine1: '12 Parramatta Rd', addressCity: 'Annandale', addressRegion: 'NSW', addressPostalCode: '2038',
  waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(),
  taxCountry: 'AU', taxRateBasisPoints: 1000, taxInclusive: true, taxId: '51 824 753 556', weekStartsOn: 'MONDAY', medicalInfoEnabled: true,
} });
const B = {};
for (const [k, name, tz, city, region, pc] of [['syd', 'Sydney (Annandale)', null, 'Annandale', 'NSW', '2038'], ['per', 'Perth (Northbridge)', 'Australia/Perth', 'Northbridge', 'WA', '6003'], ['lhi', 'Lord Howe Island', 'Australia/Lord_Howe', 'Lord Howe Island', 'NSW', '2898']]) {
  B[k] = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name, timezone: tz, addressCountry: 'AU', addressCity: city, addressRegion: region, addressPostalCode: pc } });
}
const owner = add(mk(ageDob(41), { firstName: 'Jack', surname: 'Nguyen' }), 'owner');
const coOwner = add(mk(ageDob(38), { firstName: 'Sarah', surname: 'Nguyen' }), 'coOwner');
const coaches = [['syd', 'Bruno'], ['syd', 'Kirra'], ['per', 'Dylan'], ['per', 'Mai'], ['lhi', 'Tom'], ['syd', 'Aisha']].map(([b, n]) => ({ b, u: add(mk(ageDob(30), { firstName: n, surname: 'Coach' }), 'coach') }));
const staffS = add(mk(ageDob(25), { firstName: 'Bea', surname: 'Desk' }), 'staffSyd');
const staffP = add(mk(ageDob(27), { firstName: 'Pete', surname: 'Desk' }), 'staffPer');
const extraStaff = add(mk(ageDob(29), { firstName: 'Newbie', surname: 'Staff' }), 'newStaff'); // no role yet: for invite tests

// Students: ~780.
const branchKeys = ['syd', 'syd', 'syd', 'syd', 'per', 'per', 'lhi'];
const studs = [];
const S = (u, tag, b = pick(branchKeys)) => { add(u, tag); studs.push({ u, b, tag }); return u; };
for (let i = 0; i < 12; i++) S(mk(ageDob(2 + rand() * 2.5)), 'toddler');
for (let i = 0; i < 160; i++) S(mk(ageDob(5 + rand() * 7.5)), 'kid');
for (let i = 0; i < 100; i++) S(mk(ageDob(13 + rand() * 4.8)), 'teen');
for (let i = 0; i < 450; i++) S(mk(ageDob(18.3 + rand() * 50)), 'adult');
for (let i = 0; i < 10; i++) S(mk(ageDob(70 + rand() * 12)), 'senior');
// Specials.
const t18soon = new Date(now - 18 * YEAR + 3 * DAY); t18soon.setUTCHours(0, 0, 0, 0);
const t18yday = new Date(now - 18 * YEAR - 1 * DAY); t18yday.setUTCHours(0, 0, 0, 0);
const special = {
  turning18: S(mk(t18soon, { firstName: 'Ruby', surname: 'Almost-Adult' }), 'turning18', 'syd'),
  turned18: S(mk(t18yday, { firstName: 'Max', surname: 'Just-Adult' }), 'turned18', 'syd'),
  ninetyFive: S(mk(ageDob(95.2), { firstName: 'Edna', surname: 'Ninety-Five' }), 'age95', 'syd'),
  medical: S(mk(ageDob(34), { firstName: 'Liam', surname: 'Wheelchair-User' }), 'medical', 'syd'),
  longName: S(mk(ageDob(30), { firstName: 'Bartholomew-Alexander Maximilian Fitzgerald-Montgomery', surname: 'Wolfeschlegelsteinhausenbergerdorff Featherstonehaugh-Cholmondeley the Third' }), 'long', 'syd'),
  mononym: S(mk(ageDob(28), { firstName: 'Kurnia', surname: '' }), 'mononym', 'per'),
  viet: S(mk(ageDob(26), { firstName: 'Nguyễn Thị', surname: 'Minh Khai' }), 'viet', 'syd'),
  chinese: S(mk(ageDob(31), { firstName: '小明', surname: '王' }), 'cjk', 'syd'),
  arabic: S(mk(ageDob(33), { firstName: 'محمد', surname: 'الحسيني' }), 'rtl', 'syd'),
  emoji: S(mk(ageDob(24), { firstName: 'Shazza 🥊', surname: "O'Brien-D'Arcy" }), 'emoji', 'syd'),
  combining: S(mk(ageDob(22), { firstName: 'Zoë', surname: 'Reńe' }), 'combining', 'syd'),
  leap: S(mk(new Date('2012-02-29T00:00:00Z'), { firstName: 'Leap', surname: 'Day' }), 'leap', 'syd'),
  lhiKid: S(mk(ageDob(9), { firstName: 'Island', surname: 'Kid' }), 'lhiKid', 'lhi'),
  mover: S(mk(ageDob(35), { firstName: 'Moving', surname: 'West' }), 'mover', 'syd'),
  returner: S(mk(ageDob(40), { firstName: 'Back', surname: 'Again' }), 'returner', 'per'),
};
// A coach (Aisha) also trains as a student at Sydney.
studs.push({ u: coaches[5].u, b: 'syd', tag: 'coachStudent' });

await db.user.createMany({ data: users.map(({ _tag, ...u }) => u) });

const grants = [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
  ...coaches.map((c) => ({ id: randomUUID(), userId: c.u.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: B[c.b].id })),
  { id: randomUUID(), userId: staffS.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: B.syd.id },
  { id: randomUUID(), userId: staffP.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: B.per.id },
  ...studs.map((s) => ({ id: randomUUID(), userId: s.u.id, role: 'STUDENT', schoolId: school.id, branchId: B[s.b].id })),
];
await db.roleGrant.createMany({ data: grants });
await db.instructor.createMany({ data: coaches.map((c) => ({ id: randomUUID(), userId: c.u.id, schoolId: school.id, branchId: B[c.b].id })) });
// The returner left 200 days ago and came back: an old ended grant too.
await db.roleGrant.create({ data: { id: randomUUID(), userId: special.returner.id, role: 'STUDENT', schoolId: school.id, branchId: B.per.id, createdAt: new Date(now - 500 * DAY), revokedAt: new Date(now - 200 * DAY) } });

// Guardians: every toddler/kid, half the teens, plus turning18. Families of 1-3.
const minors = studs.filter((s) => ['toddler', 'kid', 'lhiKid', 'turning18', 'leap'].includes(s.tag) || (s.tag === 'teen' && rand() < 0.5));
const fams = []; for (let i = 0; i < minors.length;) { const n = ri(1, 3); fams.push(minors.slice(i, i + n)); i += n; }
const gUsers = fams.map(() => mk(ageDob(30 + rand() * 15)));
// The second Guardian for the first family (divorced parents).
const g2 = mk(ageDob(40), { firstName: 'Second', surname: 'Parent' });
await db.user.createMany({ data: [...gUsers, g2] });
await db.roleGrant.createMany({ data: [...gUsers, g2].map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })) });
await db.guardianLink.createMany({ data: [...fams.flatMap((f, i) => f.map((k) => ({ id: randomUUID(), guardianId: gUsers[i].id, studentId: k.u.id }))), { id: randomUUID(), guardianId: g2.id, studentId: fams[0][0].u.id }] });
// A Guardian who also trains (family 1's parent).
await db.roleGrant.create({ data: { id: randomUUID(), userId: gUsers[1].id, role: 'STUDENT', schoolId: school.id, branchId: B.syd.id } });

// Plans (cents, GST inclusive).
const plan = (type, title, cents, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: cents, currency: 'AUD', ...extra });
const plans = [
  plan('SUBSCRIPTION', 'Unlimited BJJ + Boxing', 18900), plan('SUBSCRIPTION', 'Kids Unlimited', 13900),
  plan('CLASS_PACK', '10-class pack', 25000, { classesIncluded: 10, expiryDurationDays: 90 }), plan('CLASS_PACK', '1 drop-in', 3013, { classesIncluded: 1, expiryDurationDays: 30 }),
  plan('WEEKLY_PASS', 'Week pass (visitors)', 4500, { expiryDurationDays: 7 }), plan('FRIEND_PASS', 'Bring a mate', 0, { classesIncluded: 1 }),
  plan('TRIAL_MEMBERSHIP', 'Free 7-day trial', 0, { expiryDurationDays: 7 }),
];
await db.membershipPlan.createMany({ data: plans });
const P = Object.fromEntries(plans.map((p) => [p.title, p]));
const mships = [];
for (const s of studs) {
  if (s.tag === 'coachStudent') { mships.push({ id: randomUUID(), studentId: s.u.id, schoolId: school.id, membershipPlanId: P['Unlimited BJJ + Boxing'].id, frequency: 'RECURRING' }); continue; }
  const r = rand();
  const kid = ['toddler', 'kid', 'lhiKid', 'leap'].includes(s.tag);
  if (r < 0.65) mships.push({ id: randomUUID(), studentId: s.u.id, schoolId: school.id, membershipPlanId: (kid ? P['Kids Unlimited'] : P['Unlimited BJJ + Boxing']).id, frequency: 'RECURRING' });
  else if (r < 0.85) mships.push({ id: randomUUID(), studentId: s.u.id, schoolId: school.id, membershipPlanId: P['10-class pack'].id, frequency: 'ONE_TIME', classesRemaining: ri(1, 10), expiryDate: new Date(now + ri(5, 90) * DAY) });
  else if (r < 0.9) mships.push({ id: randomUUID(), studentId: s.u.id, schoolId: school.id, membershipPlanId: P['Free 7-day trial'].id, frequency: 'ONE_TIME', expiryDate: new Date(now + 5 * DAY) });
  // the rest: no membership
}
await db.membership.createMany({ data: mships });

// --- API: disciplines, slots, one-off classes ---
const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
const disc = await call('seed', 'POST', `/schools/${school.id}/disciplines/from-template`, tOwner, { templateId: 'ibjjf', name: 'BJJ' });
if (disc.status >= 300) throw new Error('tpl ' + JSON.stringify(disc.body));
const bjj = await db.discipline.findUnique({ where: { id: disc.body.id } });
const boxR = await call('seed', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: 'Boxing' });
if (boxR.status >= 300) throw new Error('boxing ' + JSON.stringify(boxR.body));
const box = await db.discipline.findUnique({ where: { id: boxR.body.id } });
const st = (d) => [{ disciplineId: d.id, classType: (d.classTypesOffered || [])[0] ?? null }];
const C = Object.fromEntries(coaches.map((c) => [c.u.firstName, c.u]));
const slotSpecs = [
  ['syd', 'Bruno', 'MONDAY', '06:00', '07:00', bjj, 'BJJ Fundamentals'], ['syd', 'Bruno', 'WEDNESDAY', '18:00', '19:30', bjj, 'BJJ Advanced'],
  ['syd', 'Kirra', 'TUESDAY', '18:00', '19:00', box, 'Boxing'], ['syd', 'Kirra', 'THURSDAY', '18:00', '19:00', box, 'Boxing'],
  ['syd', 'Aisha', 'SATURDAY', '09:00', '10:00', bjj, 'Kids BJJ'], ['syd', 'Bruno', 'SUNDAY', '02:30', '03:30', bjj, 'Night Owl Open Mat'],
  ['syd', 'Aisha', 'FRIDAY', '22:30', '23:59', box, 'Late Boxing'],
  ['per', 'Dylan', 'MONDAY', '18:00', '19:00', bjj, 'BJJ Perth'], ['per', 'Mai', 'TUESDAY', '06:30', '07:30', box, 'Boxing Perth'], ['per', 'Dylan', 'SATURDAY', '08:00', '09:00', bjj, 'Kids BJJ Perth'],
  ['lhi', 'Tom', 'SUNDAY', '01:45', '02:45', bjj, 'LHI Dawn Patrol'], ['lhi', 'Tom', 'WEDNESDAY', '17:30', '18:30', box, 'LHI Boxing'],
];
const slots = [];
for (const [b, c, d, s, e, dd, title] of slotSpecs) {
  const r = await call('seed', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: B[b].id, instructorId: C[c].id, weekday: d, startTime: s, endTime: e, title, styles: st(dd), capacity: 30 });
  if (r.status >= 300) throw new Error('slot ' + title + ' ' + JSON.stringify(r.body));
  slots.push({ id: r.body.id, b, coach: c, title, weekday: d, start: s, end: e });
}
// One-off classes: one now at each branch, a tiny one, and a cross-midnight one-off.
const mkClass = async (b, c, title, startOff, endOff, extra = {}) => {
  const r = await call('seed', 'POST', `/schools/${school.id}/classes`, tOwner, { branchId: B[b].id, instructorId: C[c].id, title, styles: st(bjj), startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + endOff).toISOString(), membershipInclusion: true, capacity: 30, ...extra });
  if (r.status >= 300) throw new Error('class ' + title + JSON.stringify(r.body));
  return r.body.id;
};
const classes = {
  nowSyd: await mkClass('syd', 'Bruno', 'Now Sydney', -10 * 60e3, 50 * 60e3),
  nowSyd2: await mkClass('syd', 'Kirra', 'Now Sydney Kirra', -10 * 60e3, 50 * 60e3),
  nowPer: await mkClass('per', 'Dylan', 'Now Perth', -10 * 60e3, 50 * 60e3),
  nowLhi: await mkClass('lhi', 'Tom', 'Now LHI', -10 * 60e3, 50 * 60e3),
  tiny: await mkClass('syd', 'Bruno', 'Tiny comp prep', 2 * 3600e3, 3 * 3600e3, { capacity: 2 }),
  tomorrow: await mkClass('syd', 'Bruno', 'Tomorrow BJJ', 26 * 3600e3, 27 * 3600e3),
};

const cast = {
  schoolId: school.id, branches: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.id])), bjj: bjj.id, box: box.id,
  owner: owner.id, coOwner: coOwner.id, coaches: coaches.map((c) => ({ id: c.u.id, name: c.u.firstName, b: c.b })), staffSyd: staffS.id, staffPer: staffP.id, newStaff: extraStaff.id,
  students: studs.map((s) => ({ id: s.u.id, b: s.b, tag: s.tag, email: s.u.email })), special: Object.fromEntries(Object.entries(special).map(([k, u]) => [k, u.id])),
  guardians: fams.map((f, i) => ({ id: gUsers[i].id, kids: f.map((k) => k.u.id) })), g2: g2.id, plans: Object.fromEntries(plans.map((p) => [p.title, p.id])),
  memberships: Object.fromEntries(mships.map((m) => [m.studentId, m.membershipPlanId])), slots, classes,
};
fs.writeFileSync(new URL('./cast-au.json', import.meta.url), JSON.stringify(cast, null, 1));
console.log({ students: studs.length, guardians: gUsers.length + 1, users: users.length + gUsers.length + 1, memberships: mships.length, slots: slots.length, minors: minors.length });
await db.$disconnect();
