// Round 5 GB: Siobhán O'Brien's family karate club in Manchester.
// Seeds two Schools (the club with 2 Branches, plus a small second School for
// cross-School checks), ~430 people, mostly children with Guardians.
// Users, staff grants, bulk Guardian links and memberships go straight into the
// DB (as round4/world.mjs does); the special families go through the real API
// (POST /guardians/me/minors, POST /schools/:id/join, add-child-manually).
// Writes gb-cast.json next to this file.
import fs from 'fs';
import { createRequire } from 'module';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const bcrypt = require('bcrypt');

const RUN = Date.now().toString(36);
const now = Date.now();
const DAY = 86400e3;
const PASS = '246810';
const passHash = await bcrypt.hash(PASS, 4);
let k = 0;
const phone = () => `+447${String(700000000 + Math.floor(Math.random() * 99999999)).slice(0, 9)}`;
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (y, extraDays = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() + extraDays); d.setUTCHours(0, 0, 0, 0); return d; };

async function adult(first, surname, extra = {}) {
  const u = { id: randomUUID(), email: `r5-gb-${RUN}-${k++}@stress.test`, phone: phone(), firstName: first, surname, passcodeHash: passHash, dateOfBirth: yearsAgo(35), phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'GBP', ...extra };
  await db.user.create({ data: u });
  return u;
}
// A child as GuardiansService.createMinor makes one (placeholder email, no login).
async function dbMinor(guardian, first, surname, dob) {
  const id = randomUUID();
  const u = { id, email: `minor+${id}@guardian-managed.ultm8.internal`, phone: `+000${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`, firstName: first, surname, passcodeHash: 'x', dateOfBirth: dob };
  await db.user.create({ data: u });
  await db.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: id } });
  return u;
}

async function mkSchool(name, branchNames) {
  const school = await db.school.create({ data: {
    id: randomUUID(), name, timezone: 'Europe/London', ranksToggle: true, defaultCurrency: 'GBP', defaultLanguage: 'en-GB', addressCountry: 'GB',
    addressLine1: '12 Stockport Road', addressCity: 'Manchester', addressPostalCode: 'M19 3AB', waitlistClaimWindowMinutes: 60,
    classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), taxCountry: 'GB', weekStartsOn: 'MONDAY', medicalInfoEnabled: true,
  } });
  const branches = [];
  for (const b of branchNames) branches.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: b, addressCountry: 'GB', addressCity: 'Manchester' } }));
  return { school, branches };
}

// ---------------- School A: the club ----------------
const { school: A, branches: [lev, did] } = await mkSchool(`R5 GB Red Rose Family Karate ${RUN}`, ['Levenshulme', 'Didsbury']);
const owner = await adult('Siobhán', "O'Brien");
const instrLev = await adult('Kenji', 'Hartley-Morris');
const instrDid = await adult('Kieran', 'Ó Súilleabháin'); // also a Guardian (below)
const staffLev = await adult('Bríd', 'MacNamara');
const staffDid = await adult('Tom', 'Ashworth');
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: A.id, isMainOwner: true },
  { id: randomUUID(), userId: instrLev.id, role: 'INSTRUCTOR', schoolId: A.id, branchId: lev.id },
  { id: randomUUID(), userId: instrDid.id, role: 'INSTRUCTOR', schoolId: A.id, branchId: did.id },
  { id: randomUUID(), userId: staffLev.id, role: 'BRANCH_STAFF', schoolId: A.id, branchId: lev.id },
  { id: randomUUID(), userId: staffDid.id, role: 'BRANCH_STAFF', schoolId: A.id, branchId: did.id },
] });
await db.instructor.createMany({ data: [
  { id: randomUUID(), userId: instrLev.id, schoolId: A.id, branchId: lev.id },
  { id: randomUUID(), userId: instrDid.id, schoolId: A.id, branchId: did.id },
] });
const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', A.id)]);

const disc = await call('seed:disc', 'POST', `/schools/${A.id}/disciplines`, tOwner, { name: 'Karate' });
if (disc.status >= 300) throw new Error('disc ' + JSON.stringify(disc.body));
const styles = [{ disciplineId: disc.body.id, classType: null }];

// Waiver (adult + parental consent wording).
const waiver = await call('seed:waiver', 'POST', `/schools/${A.id}/waivers`, tOwner, { title: 'Red Rose liability & photo consent', body: 'I accept the risks of karate training. Parents/carers sign for under-18s.' });
if (waiver.status >= 300) throw new Error('waiver ' + JSON.stringify(waiver.body));

// Plans (GBP, pence).
const plan = (type, title, price, extra = {}) => ({ id: randomUUID(), schoolId: A.id, type, title, price, currency: 'GBP', ...extra });
const plans = [
  plan('SUBSCRIPTION', 'Little Dragons monthly', 3500), plan('SUBSCRIPTION', 'Juniors monthly', 4200), plan('SUBSCRIPTION', 'Adults monthly', 5000),
  plan('CLASS_PACK', '10-class pack', 7500, { classesIncluded: 10, expiryDurationDays: 90 }), plan('WEEKLY_PASS', 'Holiday week pass', 2500, { expiryDurationDays: 7 }),
  plan('TRIAL_MEMBERSHIP', 'Free taster fortnight', 0, { expiryDurationDays: 14 }), plan('CLASS_PACK', 'Single class £9.99', 999, { classesIncluded: 1, expiryDurationDays: 30 }),
];
await db.membershipPlan.createMany({ data: plans });
const P = Object.fromEntries(plans.map((p) => [p.title, p.id]));

// Timetable through the API: Little Dragons, Juniors, Adults on both Branches.
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const slots = [];
for (const [i, d] of DAYS.entries()) {
  for (const [b, ins] of [[lev, instrLev], [did, instrDid]]) {
    for (const [t0, t1, title] of [['16:00', '16:40', 'Little Dragons (3–6)'], ['17:00', '18:00', 'Juniors (7–12)'], ['18:15', '19:30', 'Teens & Adults']]) {
      if (d === 'SATURDAY' && t0 !== '16:00') continue;
      const r = await call('seed:slot', 'POST', `/schools/${A.id}/timetable`, tOwner, { branchId: b.id, instructorId: ins.id, weekday: d, startTime: t0, endTime: t1, title, styles, capacity: 24 });
      if (r.status >= 300) throw new Error('slot ' + JSON.stringify(r.body));
      slots.push(r.body.id);
    }
  }
}
// One-off classes for tests (Levenshulme), waiver required on one.
const mkClass = async (title, startOff, extra = {}, branch = lev, ins = instrLev) => {
  const r = await call('seed:class', 'POST', `/schools/${A.id}/classes`, tOwner, { branchId: branch.id, instructorId: ins.id, title, styles, startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + startOff + 3600e3).toISOString(), membershipInclusion: true, capacity: 20, ...extra });
  if (r.status >= 300) throw new Error('class ' + JSON.stringify(r.body));
  return r.body.id;
};
const classes = {
  open1: await mkClass('Juniors grading prep', 2 * DAY),
  open2: await mkClass('Family kata', 3 * DAY),
  open3: await mkClass('Saturday squad', 4 * DAY),
  waiverReq: await mkClass('Sparring (waiver needed)', 5 * DAY, { termsWaiverRequired: true }),
  didsbury: await mkClass('Didsbury juniors', 2 * DAY, {}, did, instrDid),
  tiny: await mkClass('Tiny class', 6 * DAY, { capacity: 1 }),
};

// ---------------- bulk members (DB) ----------------
const FIRST = ['Aoife', 'Oliver', 'Niamh', 'Harry', 'Zoë', 'Cian', 'Amelia', 'Muhammad', 'Isla', 'Freddie', 'Ffion', 'Rhys', 'Priya', 'Kai', 'Chloé', 'Seán'];
const LAST = ["O'Brien", 'Smith-Jones', 'MacDonald', "D'Arcy", 'Patel', 'Nowak', 'Okafor', 'Ní Bhriain', 'ap Gwyn', 'Begum'];
const pick = (a, i) => a[i % a.length];
const bulkKids = []; const bulkGuardians = [];
for (let f = 0; f < 160; f++) {
  const g = await adult(pick(FIRST, f + 3), pick(LAST, f), { dateOfBirth: yearsAgo(30 + (f % 20)) });
  bulkGuardians.push(g);
  const n = 1 + (f % 3 === 0 ? 1 : 0) + (f % 7 === 0 ? 1 : 0);
  for (let c = 0; c < n; c++) {
    const kid = await dbMinor(g, pick(FIRST, f * 3 + c), g.surname, yearsAgo(3 + ((f + c * 5) % 14), -(f % 300)));
    bulkKids.push({ ...kid, guardian: g.id, branch: f % 2 ? did.id : lev.id });
  }
}
const bulkAdults = [];
for (let i = 0; i < 70; i++) bulkAdults.push({ ...(await adult(pick(FIRST, i + 7), pick(LAST, i + 2), { dateOfBirth: yearsAgo(19 + (i % 50)) })), branch: i % 2 ? did.id : lev.id });
// A 95-year-old and a 72-year-old.
bulkAdults.push({ ...(await adult('Margaret', 'Hughes', { dateOfBirth: yearsAgo(95) })), branch: lev.id });
bulkAdults.push({ ...(await adult('Desmond', "O'Leary", { dateOfBirth: yearsAgo(72) })), branch: did.id });
const allBulk = [...bulkKids, ...bulkAdults];
await db.roleGrant.createMany({ data: allBulk.map((s) => ({ id: randomUUID(), userId: s.id, role: 'STUDENT', schoolId: A.id, grantedById: s.guardian ?? s.id })) });
await db.studentHomeBranch.createMany({ data: allBulk.map((s) => ({ id: randomUUID(), schoolId: A.id, studentId: s.id, branchId: s.branch })) });
await db.membership.createMany({ data: allBulk.map((s, i) => ({ id: randomUUID(), studentId: s.id, schoolId: A.id, membershipPlanId: s.guardian ? (i % 2 ? P['Juniors monthly'] : P['Little Dragons monthly']) : P['Adults monthly'], frequency: 'RECURRING' })) });

// ---------------- the special families, through the API ----------------
const gTok = (u) => tokenRca(u, []);
async function apiMinor(g, first, surname, dob, gender) {
  const r = await call('seed:minor', 'POST', '/guardians/me/minors', gTok(g), { firstName: first, surname, dateOfBirth: dob, gender });
  if (r.status >= 300) throw new Error('minor ' + JSON.stringify(r.body));
  return { id: r.body.studentId, firstName: first, surname };
}
async function apiJoin(g, child, branch, extra = {}) {
  const r = await call('seed:join', 'POST', `/schools/${A.id}/join`, gTok(g), { studentId: child.id, branchId: branch.id, ...extra });
  if (r.status >= 300) throw new Error('join ' + JSON.stringify(r.body));
}
const sp = {};
// Siblings + toddler on one Guardian.
sp.maire = await adult('Máire', 'Ní Dhomhnaill');
sp.aoife = await apiMinor(sp.maire, 'Aoife', 'Ní Dhomhnaill', ymd(yearsAgo(8)), 'FEMALE');
sp.cian = await apiMinor(sp.maire, 'Cian', 'Ó Dhomhnaill', ymd(yearsAgo(5)), 'MALE');
sp.saoirse = await apiMinor(sp.maire, 'Saoirse', 'Ní Dhomhnaill', ymd(yearsAgo(2, -180)), 'FEMALE'); // 2½
for (const c of [sp.aoife, sp.cian, sp.saoirse]) await apiJoin(sp.maire, c, lev);
// Divorced parents: Mum creates Niamh; Dad gets added by the owner later (tests).
sp.mum = await adult('Sinéad', 'Kelly');
sp.dad = await adult('Declan', 'Kelly');
sp.niamh = await apiMinor(sp.mum, 'Niamh', 'Kelly', '2016-02-29', 'FEMALE'); // leap-day birthday
await apiJoin(sp.mum, sp.niamh, lev, { medicalInfo: 'Asthma — blue inhaler in bag. Mild nut allergy.', medicalConsent: true });
// Guardian who also trains at the club.
sp.patrick = await adult('Patrick', 'Byrne');
await db.roleGrant.create({ data: { id: randomUUID(), userId: sp.patrick.id, role: 'STUDENT', schoolId: A.id, grantedById: sp.patrick.id } });
await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: A.id, studentId: sp.patrick.id, branchId: lev.id } });
await db.membership.create({ data: { id: randomUUID(), studentId: sp.patrick.id, schoolId: A.id, membershipPlanId: P['Adults monthly'], frequency: 'RECURRING' } });
sp.oisin = await apiMinor(sp.patrick, 'Oisín', 'Byrne', ymd(yearsAgo(9)), 'MALE');
await apiJoin(sp.patrick, sp.oisin, lev);
// Instructor (Didsbury) who is also a parent; child at Levenshulme.
sp.ruairi = await apiMinor(instrDid, 'Ruairí', 'Ó Súilleabháin', ymd(yearsAgo(11)), 'MALE');
await apiJoin(instrDid, sp.ruairi, lev);
// Turning 18 tomorrow / turned 18 yesterday / 18 today (guardian-managed).
sp.ann = await adult('Ann', 'Murphy');
sp.ciara = await apiMinor(sp.ann, 'Ciara', 'Murphy', ymd(yearsAgo(18, 1)), 'FEMALE');
// Round 6 adaptation (Decision 430): an adult can't be added as a child. Ronan was added
// while still 17 and turned 18 yesterday: add him at 17, then move his birthday back.
sp.ronan = await apiMinor(sp.ann, 'Ronan', 'Murphy', ymd(yearsAgo(18, 2)), 'MALE');
for (const c of [sp.ciara, sp.ronan]) await apiJoin(sp.ann, c, did);
await db.user.update({ where: { id: sp.ronan.id }, data: { dateOfBirth: yearsAgo(18, -1) } }); // ...and the birthday came
// A child with no Guardian, self-registered (has a login), 10 years old.
sp.liam = await adult('Liam', 'Walsh', { dateOfBirth: yearsAgo(10) });
await db.roleGrant.create({ data: { id: randomUUID(), userId: sp.liam.id, role: 'STUDENT', schoolId: A.id, grantedById: sp.liam.id } });
await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: A.id, studentId: sp.liam.id, branchId: lev.id } });
// A teen with a disability note, very long name, mononym, Welsh, emoji.
// Round 6 adaptation: surnames are now limited to 100 characters (130 refused, 400);
// the long-name child keeps a 100-character surname.
{ const tooLong = await call('seed:minor-130', 'POST', '/guardians/me/minors', gTok(sp.maire), { firstName: 'Llŷr', surname: 'ap Gwyn-Wynne-Fitzgerald-'.repeat(5) + 'Jones', dateOfBirth: ymd(yearsAgo(14)), gender: 'MALE' }); console.log('130-character surname:', tooLong.status); }
sp.long = await apiMinor(sp.maire, 'Llŷr', ('ap Gwyn-Wynne-Fitzgerald-'.repeat(5) + 'Jones').slice(0, 100), ymd(yearsAgo(14)), 'MALE');
sp.mono = await apiMinor(sp.ann, 'Bodhi', '🥋', ymd(yearsAgo(7)), null);
for (const c of [sp.long, sp.mono]) await apiJoin(c === sp.long ? sp.maire : sp.ann, c, did);
// Pay the special children's memberships (DB, like a past purchase).
const paidKids = [sp.aoife, sp.cian, sp.saoirse, sp.niamh, sp.oisin, sp.ruairi, sp.ciara, sp.ronan, sp.long, sp.mono];
await db.membership.createMany({ data: paidKids.map((c) => ({ id: randomUUID(), studentId: c.id, schoolId: A.id, membershipPlanId: P['10-class pack'], frequency: 'ONE_TIME', classesRemaining: 10, expiryDate: new Date(now + 60 * DAY) })) });

// ---------------- School B: another School (cross-School checks) ----------------
const { school: B, branches: [bMain] } = await mkSchool(`R5 GB Salford Judo ${RUN}`, ['Salford']);
const ownerB = await adult('Gareth', 'Pryce');
const staffB = await adult('Joanne', 'Lees');
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: ownerB.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: B.id, isMainOwner: true },
  { id: randomUUID(), userId: staffB.id, role: 'BRANCH_STAFF', schoolId: B.id, branchId: bMain.id },
] });
// Aoife also does judo at School B (her mum enrols her).
await call('seed:joinB', 'POST', `/schools/${B.id}/join`, gTok(sp.maire), { studentId: sp.aoife.id, branchId: bMain.id }).then((r) => { if (r.status >= 300) throw new Error('joinB ' + JSON.stringify(r.body)); });

const out = {
  run: RUN, pass: PASS, schoolA: A.id, schoolB: B.id, branches: { lev: lev.id, did: did.id, bMain: bMain.id },
  waiverId: waiver.body.id, disciplineId: disc.body.id, plans: P, classes, slots,
  users: Object.fromEntries(Object.entries({ owner, instrLev, instrDid, staffLev, staffDid, ownerB, staffB, ...sp }).map(([n, u]) => [n, { id: u.id, email: u.email, firstName: u.firstName, surname: u.surname }])),
  counts: { bulkKids: bulkKids.length, bulkGuardians: bulkGuardians.length, bulkAdults: bulkAdults.length, specials: Object.keys(sp).length, slots: slots.length },
  sampleBulkKid: bulkKids[0], sampleBulkGuardian: { id: bulkGuardians[0].id, email: bulkGuardians[0].email },
};
fs.writeFileSync(new URL('./gb-cast.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.counts, A.id);
await db.$disconnect();
process.exit(0);
