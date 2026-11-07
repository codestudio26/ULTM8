// Round 5, US persona (Mike): an MMA chain, ~1,000 people, four Branches in four
// US time zones (New York inherits the School's zone, LA/Phoenix/Honolulu override).
// Users, grants, Guardian links and memberships go straight into the DB (world.mjs
// pattern); styles, slots and classes go through the API. Writes cast-us.json.
//   CAST=../empty-cast.json node seed.mjs
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const now = Date.now();
const YEAR = 365.25 * 86400e3;
const DAY = 86400e3;
let rnd = 777; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const FIRST = ['Liam', 'Emma', 'José', 'DeShawn', 'Mary-Kate', 'Nguyễn', 'Aaliyah', 'Jake', "D'Andre", 'Zoë', 'Kekoa', 'Leilani', 'Mateo', 'Sofía', 'Tyrone', 'Ashley'];
const LAST = ['Johnson', 'García', "O'Neil", 'Washington', 'Kim', 'Smith-Jones', 'Kahananui', 'Nakamura', 'Rodríguez', 'Begay', 'MacArthur', 'Nguyen'];
let seq = 0;
const tag = Date.now().toString(36);
function mk(over = {}) {
  const k = seq++;
  return {
    id: randomUUID(), email: `r5-us-${tag}-${k}@stress.test`, phone: `+1555${String(1000000 + k + Math.floor(rand() * 1000) * 1000).slice(-7)}${k % 10}`.slice(0, 12),
    firstName: pick(FIRST), surname: pick(LAST), passcodeHash: 'x', dateOfBirth: new Date(now - (20 + rand() * 30) * YEAR),
    phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'USD', gender: rand() < 0.5 ? 'MALE' : 'FEMALE', ...over,
  };
}
const users = [];
const U = (o) => { const u = mk(o); users.push(u); return u; };
// Unique phones: overwrite with a counter-based number.
const fixPhones = () => users.forEach((u, i) => { u.phone = `+1202${String(5000000 + i).padStart(7, '0')}`; });

const school = await db.school.create({ data: {
  id: randomUUID(), name: 'R5 US Iron Cage MMA', timezone: 'America/New_York', ranksToggle: true, defaultCurrency: 'USD', defaultLanguage: 'en-GB',
  addressCountry: 'US', waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(),
  taxCountry: 'US', weekStartsOn: 'SUNDAY', defaultRefundCutoffHours: 24,
} });
const BR = [['New York', null], ['Los Angeles', 'America/Los_Angeles'], ['Phoenix', 'America/Phoenix'], ['Honolulu', 'Pacific/Honolulu']];
const branches = [];
for (const [name, tz] of BR) branches.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name, timezone: tz, addressCountry: 'US' } }));

const owner = U({ firstName: 'Mike', surname: 'Russo' });
const coOwner = U({ firstName: 'Dana', surname: 'Russo' });
const instructors = branches.flatMap(() => [U(), U()]);
const bstaff = branches.map(() => U());
// Special people.
const special = {
  turning18: U({ firstName: 'Tyler', surname: 'Soon-Eighteen', dateOfBirth: new Date(Date.UTC(2008, 10, 7)) }),
  turned18: U({ firstName: 'Kayla', surname: 'Just-Eighteen', dateOfBirth: new Date(Date.UTC(2008, 10, 3)) }),
  leap: U({ firstName: 'Leap', surname: 'Day', dateOfBirth: new Date(Date.UTC(2012, 1, 29)) }),
  senior95: U({ firstName: 'Walter', surname: 'Old-Timer', dateOfBirth: new Date(Date.UTC(1931, 5, 1)) }),
  longName: U({ firstName: 'Christopher-Alexander-Maximilian-Jonathan-Bartholomew', surname: "Wolfeschlegelsteinhausenbergerdorff-O'Connor-de la Vega y Montoya III" }),
  mononym: U({ firstName: 'Ikaika', surname: '' }),
  emoji: U({ firstName: 'Jo 🥊', surname: 'Nguyễn' }),
  rtl: U({ firstName: 'محمد', surname: 'Al-Amin' }),
};
const N = 960;
const students = [];
for (let i = 0; i < N; i++) {
  const r = rand();
  const dob = r < 0.05 ? new Date(now - (2 + rand() * 2) * YEAR) : r < 0.25 ? new Date(now - (5 + rand() * 8) * YEAR) : r < 0.35 ? new Date(now - (13 + rand() * 4.5) * YEAR) : r < 0.95 ? new Date(now - (18.5 + rand() * 45) * YEAR) : new Date(now - (70 + rand() * 15) * YEAR);
  students.push(U({ dateOfBirth: dob }));
}
students.push(...Object.values(special));
fixPhones();
for (let i = 0; i < users.length; i += 2000) await db.user.createMany({ data: users.slice(i, i + 2000) });
const bOf = (i) => branches[i % 4];
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
  ...instructors.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[Math.floor(i / 2)].id })),
  ...bstaff.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: branches[i].id })),
  ...students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id, branchId: bOf(i).id })),
] });
await db.instructor.createMany({ data: instructors.map((u, i) => ({ id: randomUUID(), userId: u.id, schoolId: school.id, branchId: branches[Math.floor(i / 2)].id })) });

// Guardians for the under-13s, families of 1–3.
const kids = students.filter((u) => now - u.dateOfBirth.getTime() < 13 * YEAR);
const fams = []; for (let i = 0; i < kids.length;) { const n = 1 + Math.floor(rand() * 3); fams.push(kids.slice(i, i + n)); i += n; }
const gUsers = fams.map(() => mk());
gUsers.forEach((u, i) => { u.phone = `+1303${String(5000000 + i).padStart(7, '0')}`; });
await db.user.createMany({ data: gUsers });
await db.roleGrant.createMany({ data: gUsers.map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })) });
await db.guardianLink.createMany({ data: fams.flatMap((f, i) => f.map((k) => ({ id: randomUUID(), guardianId: gUsers[i].id, studentId: k.id }))) });

// Plans (cents) and memberships.
const plan = (type, title, usd, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: Math.round(usd * 100), currency: 'USD', ...extra });
const plans = [plan('SUBSCRIPTION', 'Unlimited MMA', 189), plan('CLASS_PACK', '10-class pack', 220, { classesIncluded: 10, expiryDurationDays: 90 }), plan('WEEKLY_PASS', 'Week pass', 49, { expiryDurationDays: 7 }), plan('TRIAL_MEMBERSHIP', 'Free trial', 0, { expiryDurationDays: 7 })];
await db.membershipPlan.createMany({ data: plans });
await db.membership.createMany({ data: students.map((u, i) => ({ id: randomUUID(), studentId: u.id, schoolId: school.id, membershipPlanId: i % 5 === 1 ? plans[1].id : plans[0].id, frequency: i % 5 === 1 ? 'ONE_TIME' : 'RECURRING', ...(i % 5 === 1 ? { classesRemaining: 10 } : {}) })) });

const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
const disc = await call('seed:style', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: 'MMA' });
if (disc.status >= 300) throw new Error('discipline ' + JSON.stringify(disc.body));
const styles = [{ disciplineId: disc.body.id, classType: null }];

const cast = {
  schoolId: school.id, branches: branches.map((b) => ({ id: b.id, name: b.name, tz: b.timezone })), styles,
  owner: { id: owner.id, email: owner.email }, coOwner: { id: coOwner.id, email: coOwner.email },
  instructors: instructors.map((u, i) => ({ id: u.id, email: u.email, branch: branches[Math.floor(i / 2)].id })),
  staff: bstaff.map((u, i) => ({ id: u.id, email: u.email, branch: branches[i].id })),
  students: students.map((u, i) => ({ id: u.id, email: u.email, branch: bOf(i).id })),
  special: Object.fromEntries(Object.entries(special).map(([k, u]) => [k, u.id])),
  guardians: gUsers.map((g, i) => ({ id: g.id, email: g.email, kids: fams[i].map((k) => k.id) })),
  plans: Object.fromEntries(plans.map((p) => [p.title, p.id])),
};
fs.writeFileSync(new URL('./cast-us.json', import.meta.url), JSON.stringify(cast, null, 1));
console.log({ school: school.id, students: students.length, guardians: gUsers.length, staff: 2 + instructors.length + bstaff.length, people: users.length + gUsers.length });
await db.$disconnect();
