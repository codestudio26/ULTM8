// Round 5, Nigeria (slug ng): Chukwuemeka Okonkwo-Adeyemi's taekwondo and boxing
// academy in Lagos. Two Branches (Lagos Island, Ikeja), ~500 people, NGN plans.
// Users, grants, Guardian links and memberships go straight to the DB (as
// round4/world.mjs does); disciplines, slots, classes, waivers, payment
// account go through the API. Writes ng-cast.json.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const now = Date.now();
const YEAR = 365.25 * 86400e3;
const DAY = 86400e3;
let rnd = 2340; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const RUN = process.env.RUN || String(now % 1e7);
const FIRST = ['Ọlábísí', 'Ngozi', 'Abubakar', 'Chukwuemeka', 'Adéwálé', 'Oluwaseun', 'Ìyábọ̀', 'Chiamaka', 'Emeka', 'Fatima', 'Ifeoma', 'Babátúndé', 'Zainab', 'Tèmítọ́pẹ́', 'Uchenna', 'Halima', 'Ọ̀rẹ́olúwa', 'Kelechi', 'Aisha', 'Ṣọlá'];
const LAST = ['Okonkwo', 'Adeyemi', 'Bello', 'Ọ̀ṣọ́', 'Nwachukwu', 'Okafor', 'Abdullahi', 'Adébáyọ̀', 'Eze', "Ogun-D'Souza", 'Ibrahim', 'Okonkwo-Adeyemi', 'Àjàyí', 'Danjuma', 'Obi'];
let seq = 0;
const phone = () => `+23480${String(70000000 + (now % 1000) * 10000 + seq).slice(-8)}`;
function u(over = {}) {
  const k = seq++;
  return { id: randomUUID(), email: `r5-ng-${RUN}-${k}@stress.test`, phone: phone(), firstName: pick(FIRST), surname: pick(LAST), passcodeHash: 'x', dateOfBirth: new Date(now - (20 + rand() * 40) * YEAR), phoneVerifiedAt: new Date(), language: 'en', currency: 'NGN', gender: rand() < 0.5 ? 'FEMALE' : 'MALE', ...over };
}
const dob = (years, days = 0) => new Date(now - years * YEAR + days * DAY);
const dobExact = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const turns18In = (days) => { const t = new Date(now + days * DAY); return dobExact(t.getUTCFullYear() - 18, t.getUTCMonth() + 1, t.getUTCDate()); };

const school = await db.school.create({ data: {
  id: randomUUID(), name: `R5 NG Okonkwo-Adeyemi Taekwondo & Boxing ${RUN}`, timezone: 'Africa/Lagos', ranksToggle: true,
  defaultCurrency: 'NGN', defaultLanguage: 'en', addressCountry: 'NG', addressLine1: '12 Broad Street', addressCity: 'Lagos',
  waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), taxCountry: 'NG', weekStartsOn: 'MONDAY',
} });
const island = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Lagos Island', addressCountry: 'NG', addressCity: 'Lagos' } });
const ikeja = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Ikeja', addressCountry: 'NG', addressCity: 'Ikeja' } });
const B = [island, ikeja];

// Staff: owner (Chukwuemeka, also trains), co-owner, 4 instructors (one also a Guardian), 2 Branch Staff.
const owner = u({ firstName: 'Chukwuemeka', surname: 'Okonkwo-Adeyemi', dateOfBirth: dob(46) });
const coOwner = u({ firstName: 'Ọlábísí', surname: 'Okonkwo-Adeyemi', dateOfBirth: dob(43) });
const instr = [u({ firstName: 'Abubakar', surname: 'Danjuma' }), u({ firstName: 'Ngozi', surname: 'Eze' }), u({ firstName: 'Tèmítọ́pẹ́', surname: 'Àjàyí' }), u({ firstName: 'Kelechi', surname: 'Obi' })];
const bstaff = [u({ firstName: 'Halima', surname: 'Bello' }), u({ firstName: 'Uchenna', surname: 'Nwachukwu' })];
const staffUsers = [owner, coOwner, ...instr, ...bstaff];

// Students: special people first, then ~430 ordinary.
const special = {
  toddler3: u({ firstName: 'Ṣọlá', dateOfBirth: dob(3) }),
  kid7a: u({ firstName: 'Chiamaka', surname: 'Okafor', dateOfBirth: dob(7) }),
  kid9b: u({ firstName: 'Emeka', surname: 'Okafor', dateOfBirth: dob(9) }),
  kid11c: u({ firstName: 'Ifeoma', surname: 'Okafor', dateOfBirth: dob(11) }),
  divorcedKid: u({ firstName: 'Zainab', surname: 'Ibrahim-Eze', dateOfBirth: dob(10) }),
  teen15: u({ firstName: 'Babátúndé', dateOfBirth: dob(15) }),
  turning18soon: u({ firstName: 'Aisha', surname: 'Abdullahi', dateOfBirth: turns18In(3) }),
  turned18yday: u({ firstName: 'Oluwaseun', surname: 'Adébáyọ̀', dateOfBirth: turns18In(-1) }),
  senior72: u({ firstName: 'Ìyábọ̀', surname: 'Àjàyí', dateOfBirth: dob(72) }),
  senior95: u({ firstName: 'Babátúndé', surname: 'Ọ̀ṣọ́', dateOfBirth: dob(95) }),
  disability: u({ firstName: 'Adéwálé', surname: 'Bello', dateOfBirth: dob(24) }),
  leap: u({ firstName: 'Fatima', surname: 'Danjuma', dateOfBirth: dobExact(2008, 2, 29) }),
  longName: u({ firstName: 'Ọ̀rẹ́olúwa'.repeat(6) + ' Chukwuebuka', surname: 'Okonkwo-Adeyemi-Nwachukwu-Abdullahi-Ọ̀ṣọ́-Àjàyí-Danjuma-Ibrahim-Okafor-Obi-Eze-Bello' }),
  mononym: u({ firstName: 'Ọlábísí', surname: '' }),
  emoji: u({ firstName: 'Ngozi 🥊', surname: 'Eze 🇳🇬' }),
  combining: u({ firstName: 'Ṣọ̀lá', surname: 'Ọ̀ṣọ́' }), // combining marks
  apostrophe: u({ firstName: "D'Andre", surname: "O'Neal-Okafor" }),
  moved: u({ firstName: 'Kelechi', surname: 'Moved' }),
  leftReturned: u({ firstName: 'Uchenna', surname: 'Returned' }),
};
const ordinary = Array.from({ length: 430 }, () => {
  const r = rand();
  return u({ dateOfBirth: r < 0.25 ? dob(5 + rand() * 11) : r < 0.32 ? dob(16 + rand() * 1.9) : dob(18.1 + rand() * 50) });
});
const students = [...Object.values(special), ...ordinary];
// Guardians: Okafor parent of three siblings; divorced parents both linked; owner-instructor guardian; plus families among the ordinary kids.
const gOkafor = u({ firstName: 'Ngozi', surname: 'Okafor', dateOfBirth: dob(38) });
const gMum = u({ firstName: 'Halima', surname: 'Ibrahim', dateOfBirth: dob(37) });
const gDad = u({ firstName: 'Chinedu', surname: 'Eze', dateOfBirth: dob(41) });
const kids = ordinary.filter((x) => now - x.dateOfBirth.getTime() < 16 * YEAR);
const fams = []; for (let i = 0; i + 1 < Math.min(kids.length, 90); i += 2) fams.push(kids.slice(i, i + 2));
const gOrd = fams.map(() => u({ dateOfBirth: dob(30 + rand() * 15) }));
const guardians = [gOkafor, gMum, gDad, ...gOrd];
const all = [...staffUsers, ...students, ...guardians];
await db.user.createMany({ data: all });

const g = (userId, role, branchId = null) => ({ id: randomUUID(), userId, role, schoolId: school.id, branchId });
await db.roleGrant.createMany({ data: [
  { ...g(owner.id, 'SCHOOL_OWNER_MANAGER'), isMainOwner: true }, g(coOwner.id, 'SCHOOL_OWNER_MANAGER'), g(owner.id, 'STUDENT', island.id),
  ...instr.map((x, i) => g(x.id, 'INSTRUCTOR', B[i % 2].id)), g(instr[1].id, 'STUDENT', island.id), // a coach who also trains
  ...bstaff.map((x, i) => g(x.id, 'BRANCH_STAFF', B[i % 2].id)),
  ...students.map((x, i) => g(x.id, 'STUDENT', B[i % 2].id)),
  ...guardians.map((x) => g(x.id, 'GUARDIAN')), g(gOkafor.id, 'STUDENT', island.id), // guardian who trains
  g(instr[2].id, 'GUARDIAN'),
] });
await db.instructor.createMany({ data: instr.map((x, i) => ({ id: randomUUID(), userId: x.id, schoolId: school.id, branchId: B[i % 2].id })) });
await db.guardianLink.createMany({ data: [
  ...[special.kid7a, special.kid9b, special.kid11c, special.toddler3].map((k) => ({ id: randomUUID(), guardianId: gOkafor.id, studentId: k.id })),
  { id: randomUUID(), guardianId: gMum.id, studentId: special.divorcedKid.id }, { id: randomUUID(), guardianId: gDad.id, studentId: special.divorcedKid.id },
  { id: randomUUID(), guardianId: instr[2].id, studentId: special.teen15.id }, { id: randomUUID(), guardianId: gMum.id, studentId: special.turning18soon.id },
  ...fams.flatMap((f, i) => f.map((k) => ({ id: randomUUID(), guardianId: gOrd[i].id, studentId: k.id }))),
] });

const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id), grant('STUDENT', school.id, island.id)]);
const disc = [];
for (const name of ['Taekwondo', 'Boxing']) {
  const r = await call('seed:discipline', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name });
  if (r.status >= 300) throw new Error('discipline ' + JSON.stringify(r.body));
  disc.push(r.body.id);
}
const styles = (i) => [{ disciplineId: disc[i], classType: null }];
// Weekly timetable: Mon–Sat, both Branches.
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const slots = [];
for (const [bi, b] of B.entries()) for (const [di, d] of DAYS.entries()) for (const [t0, t1, s] of [['06:00', '07:00', 1], ['17:30', '18:30', 0], ['19:00', '20:30', di % 2]]) {
  const r = await call('seed:slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: b.id, instructorId: instr[bi].id, weekday: d, startTime: t0, endTime: t1, title: `${s ? 'Boxing' : 'Taekwondo'} ${t0}`, styles: styles(s), capacity: 30 });
  if (r.status >= 300) throw new Error('slot ' + JSON.stringify(r.body));
  slots.push(r.body.id);
}
// Late-night across midnight (Saturday 23:00–00:30) — record whatever happens.
const midnight = await call('seed:slot-midnight', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: island.id, instructorId: instr[0].id, weekday: 'SATURDAY', startTime: '23:00', endTime: '00:30', title: 'Fight night sparring', styles: styles(1), capacity: 30 });

const mkClass = async (title, cap, startOff, endOff, b = island, extra = {}) => {
  const r = await call('seed:class', 'POST', `/schools/${school.id}/classes`, tOwner, { branchId: b.id, instructorId: instr[b === island ? 0 : 1].id, title, styles: styles(0), startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + endOff).toISOString(), membershipInclusion: true, ...(cap === null ? {} : { capacity: cap }), ...extra });
  if (r.status >= 300) throw new Error('class ' + JSON.stringify(r.body));
  return r.body.id;
};
const classes = {
  now: [], future: [], tiny1: null, tiny3: null,
};
for (let k = 0; k < 8; k++) classes.now.push(await mkClass(`Now ${k}`, 40, -10 * 60e3, 50 * 60e3, B[k % 2]));
for (let k = 0; k < 16; k++) classes.future.push(await mkClass(`Tomorrow ${k}`, 30, DAY + k * 3600e3, DAY + (k + 1) * 3600e3, B[k % 2]));
classes.tiny1 = await mkClass('Tiny 1 seat', 1, 2 * DAY, 2 * DAY + 3600e3);
classes.tiny3 = await mkClass('Tiny 3 seats', 3, 2 * DAY + 3600e3, 2 * DAY + 7200e3);

// Plans in naira (hundredths = kobo).
const N = (naira) => naira * 100;
const plan = (type, title, naira, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: N(naira), currency: 'NGN', ...extra });
const plans = {
  sub: plan('SUBSCRIPTION', 'Monthly unlimited', 35000), pack5: plan('CLASS_PACK', '5-class pack', 15000, { classesIncluded: 5 }),
  pack10: plan('CLASS_PACK', '10-class pack', 27500, { classesIncluded: 10, expiryDurationDays: 90 }), week: plan('WEEKLY_PASS', 'Week pass', 9000, { expiryDurationDays: 7 }),
  friend: plan('FRIEND_PASS', 'Friend pass', 0, { classesIncluded: 1 }), trial: plan('TRIAL_MEMBERSHIP', 'Free trial', 0, { expiryDurationDays: 14 }),
  drop: plan('CLASS_PACK', 'Drop-in', 4013, { classesIncluded: 1 }), // ends in 13 -> fake Stripe declines
};
await db.membershipPlan.createMany({ data: Object.values(plans) });

const kinds = [];
const ms = [];
students.forEach((x, i) => {
  const r = rand();
  const kind = i < Object.keys(special).length ? 'pack10' : r < 0.45 ? 'sub' : r < 0.65 ? 'pack10' : r < 0.75 ? 'pack5' : r < 0.82 ? 'week' : r < 0.88 ? 'trial' : 'none';
  kinds.push(kind);
  const base = { id: randomUUID(), studentId: x.id, schoolId: school.id };
  if (kind === 'sub') ms.push({ ...base, membershipPlanId: plans.sub.id, frequency: 'RECURRING' });
  if (kind === 'pack10') ms.push({ ...base, membershipPlanId: plans.pack10.id, frequency: 'ONE_TIME', classesRemaining: 10, expiryDate: new Date(now + 60 * DAY) });
  if (kind === 'pack5') ms.push({ ...base, membershipPlanId: plans.pack5.id, frequency: 'ONE_TIME', classesRemaining: 5 });
  if (kind === 'week') ms.push({ ...base, membershipPlanId: plans.week.id, frequency: 'ONE_TIME', expiryDate: new Date(now + 5 * DAY) });
  if (kind === 'trial') ms.push({ ...base, membershipPlanId: plans.trial.id, frequency: 'ONE_TIME', expiryDate: new Date(now + 10 * DAY) });
});
ms.push({ id: randomUUID(), studentId: gOkafor.id, schoolId: school.id, membershipPlanId: plans.sub.id, frequency: 'RECURRING' });
ms.push({ id: randomUUID(), studentId: owner.id, schoolId: school.id, membershipPlanId: plans.sub.id, frequency: 'RECURRING' });
await db.membership.createMany({ data: ms });

// Cash payment account + a waiver, through the API.
const acct = await call('seed:cash', 'POST', `/schools/${school.id}/payment-accounts`, tOwner, { provider: 'CASH', accountTitle: 'Front desk (cash)', country: 'NG' });
const waiver = await call('seed:waiver', 'POST', `/schools/${school.id}/waivers`, tOwner, { title: 'Liability waiver — Ìdásílẹ̀', body: 'I understand taekwondo and boxing are contact sports. Mo gbà. Ana m ekwe. Na yarda.' });

const tk = (x, role, b) => tokenRca(x, [grant(role, school.id, b ?? null)]);
const cast = {
  run: RUN, schoolId: school.id, branches: { island: island.id, ikeja: ikeja.id }, disciplines: disc, slots, midnight: { status: midnight.status, body: midnight.body },
  classes, plans: Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, p.id])), cashAccount: { status: acct.status, body: acct.body }, waiver: { status: waiver.status, id: waiver.body?.id, version: waiver.body?.version },
  owner: { ...owner, tok: tOwner }, coOwner: { ...coOwner, tok: tk(coOwner, 'SCHOOL_OWNER_MANAGER') },
  instructors: instr.map((x, i) => ({ ...x, tok: tk(x, 'INSTRUCTOR', B[i % 2].id) })),
  staff: bstaff.map((x, i) => ({ ...x, branch: B[i % 2].id, tok: tk(x, 'BRANCH_STAFF', B[i % 2].id) })),
  special: Object.fromEntries(Object.entries(special).map(([k, x]) => [k, { id: x.id, email: x.email, phone: x.phone, firstName: x.firstName, surname: x.surname, dob: x.dateOfBirth, branch: B[students.indexOf(x) % 2].id, tok: tk(x, 'STUDENT', B[students.indexOf(x) % 2].id) }])),
  students: students.map((x, i) => ({ id: x.id, email: x.email, phone: x.phone, firstName: x.firstName, surname: x.surname, kind: kinds[i], branch: B[i % 2].id, tok: tk(x, 'STUDENT', B[i % 2].id) })),
  guardians: { okafor: { ...gOkafor, tok: tokenRca(gOkafor, [grant('GUARDIAN', school.id), grant('STUDENT', school.id, island.id)]) }, mum: { ...gMum, tok: tk(gMum, 'GUARDIAN') }, dad: { ...gDad, tok: tk(gDad, 'GUARDIAN') } },
  families: fams.map((f, i) => ({ guardian: { id: gOrd[i].id, email: gOrd[i].email, tok: tk(gOrd[i], 'GUARDIAN') }, kids: f.map((k) => k.id) })),
};
fs.writeFileSync(new URL('./ng-cast.json', import.meta.url), JSON.stringify(cast, null, 1));
console.log({ school: school.id, students: students.length, guardians: guardians.length, staff: staffUsers.length, slots: slots.length, midnight: midnight.status, acct: acct.status, waiver: waiver.status, total: all.length });
await db.$disconnect();
