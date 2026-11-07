// Round 5, DE (Jürgen Müller-Lüdenscheidt, Berlin judo/karate Verein).
// Seeds four Schools: A (the Verein, ~700 members, two Branches), B (a second
// School in Potsdam, to stand in for "another School"), C (to be closed and
// purged), D (empty, to be closed and purged). Writes cast-de.json.
// Users, grants, Guardian links, memberships and medical info go straight into
// the DB (as round 4's world.mjs does); everything else through the API.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../../../../package.json', import.meta.url));
const bcrypt = require('bcryptjs');

const RUN = Date.now().toString(36);
let seq = 0;
let rnd = 4949; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const now = Date.now();
const YEAR = 365.25 * 86400e3;
const DAY = 86400e3;
const PASS = '482915';
const passHash = await bcrypt.hash(PASS, 4);
const phoneBase = 100000000 + Math.floor(Math.random() * 800000000);

const FIRST = ['Jürgen', 'Lea-Sophie', 'Björn', 'Jörg', 'Käthe', 'Uwe', 'Hans-Peter', 'Anna-Lena', 'Ömer', 'Ayşe', 'Zoë', 'Maximilian', 'Mia', 'Lükas', 'Gerd', 'Ilse', 'Fritz', 'Søren', 'Małgorzata', 'Đorđe'];
const LAST = ['Müller-Lüdenscheidt', 'Groß', 'Schäfer', 'Weiß', 'Strauß', 'von und zu Guttenberg', 'Öztürk', 'Meißner', 'Böhm', 'Krüger', 'Fußmann', 'von der Heydt', 'Schmidt-Rottluff', 'Jäger', 'Nußbaum', "O'Brien", 'Yılmaz', 'Kowalczyk', 'Bäcker'];

function person(o = {}) {
  const k = seq++;
  const ageY = o.age ?? 25;
  return {
    id: randomUUID(), email: `r5-de-${RUN}-${k}@stress.test`, phone: '+4917' + String(phoneBase + k).padStart(9, '0'),
    firstName: o.first ?? pick(FIRST), surname: o.last ?? pick(LAST), passcodeHash: passHash,
    dateOfBirth: o.dob ?? new Date(now - ageY * YEAR - rand() * 300 * DAY), phoneVerifiedAt: new Date(), language: 'de', currency: 'EUR',
    gender: rand() < 0.5 ? 'FEMALE' : 'MALE',
  };
}
const yearsAgo = (y, extraDays = 0) => new Date(now - y * YEAR + extraDays * DAY);

async function mkSchool(name, branchNames) {
  const school = await db.school.create({ data: {
    id: randomUUID(), name, timezone: 'Europe/Berlin', ranksToggle: true, defaultCurrency: 'EUR', defaultLanguage: 'de', addressCountry: 'DE',
    addressLine1: 'Fehrbelliner Straße 7', addressCity: 'Berlin', addressPostalCode: '10119', waitlistClaimWindowMinutes: 60,
    classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), taxCountry: 'DE', weekStartsOn: 'MONDAY',
  } });
  const branches = [];
  for (const b of branchNames) branches.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: b, addressCountry: 'DE', addressCity: 'Berlin' } }));
  return { school, branches };
}

async function users(rows) { await db.user.createMany({ data: rows }); return rows; }

async function setupSchool(key, name, branchNames, nStudents) {
  const { school, branches } = await mkSchool(name, branchNames);
  const [owner, instr1, instr2, bstaff] = await users([person({ age: 52, first: key === 'A' ? 'Jürgen' : 'Owner', last: key === 'A' ? 'Müller-Lüdenscheidt' : `Inhaber ${key}` }), person({ age: 34 }), person({ age: 41 }), person({ age: 29 })]);
  const instructors = [instr1, instr2];
  await db.roleGrant.createMany({ data: [
    { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
    { id: randomUUID(), userId: instr1.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[0].id },
    { id: randomUUID(), userId: instr2.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[branches.length - 1].id },
    { id: randomUUID(), userId: bstaff.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: branches[0].id },
  ] });
  await db.instructor.createMany({ data: instructors.map((u, i) => ({ id: randomUUID(), userId: u.id, schoolId: school.id, branchId: (i ? branches[branches.length - 1] : branches[0]).id })) });
  const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
  const disc = {};
  for (const d of ['Judo', 'Karate']) {
    const r = await call('seed:disc', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: d });
    if (r.status >= 300) throw new Error('disc ' + JSON.stringify(r.body));
    disc[d] = r.body.id;
  }
  const styles = (d) => [{ disciplineId: disc[d], classType: null }];
  const slots = [];
  const specs = [['MONDAY', '17:00', '18:00', 'Judo Kinder', 'Judo'], ['TUESDAY', '19:00', '20:30', 'Karate Erwachsene', 'Karate'], ['WEDNESDAY', '18:00', '19:30', 'Judo Erwachsene', 'Judo'], ['SATURDAY', '10:00', '11:00', 'Karate Kinder', 'Karate']];
  for (const [i, b] of branches.entries()) for (const [d, s, e, t, dd] of specs) {
    const r = await call('seed:slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: b.id, instructorId: instructors[Math.min(i, 1)].id, weekday: d, startTime: s, endTime: e, title: t, styles: styles(dd), capacity: 30 });
    if (r.status >= 300) throw new Error('slot ' + JSON.stringify(r.body));
    slots.push(r.body.id);
  }
  const mkClass = async (title, startOff, endOff, b = branches[0]) => {
    const r = await call('seed:class', 'POST', `/schools/${school.id}/classes`, tOwner, { branchId: b.id, instructorId: (b === branches[0] ? instr1 : instr2).id, title, styles: styles('Judo'), startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + endOff).toISOString(), membershipInclusion: true, capacity: 40 });
    if (r.status >= 300) throw new Error('class ' + JSON.stringify(r.body));
    return r.body.id;
  };
  const nowClass = await mkClass('Randori jetzt', -10 * 60e3, 80 * 60e3);
  const nowClassB2 = await mkClass('Randori Spandau jetzt', -10 * 60e3, 80 * 60e3, branches[branches.length - 1]);
  const futureClass = await mkClass('Kata nächste Woche', 7 * DAY, 7 * DAY + 3600e3);
  const m = 100;
  const plan = (type, title, eur, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: Math.round(eur * m), currency: 'EUR', ...extra });
  const plans = [plan('SUBSCRIPTION', 'Monatsbeitrag Erwachsene', 45), plan('SUBSCRIPTION', 'Monatsbeitrag Kinder', 29.5), plan('CLASS_PACK', '10er-Karte', 120, { classesIncluded: 10, expiryDurationDays: 180 }), plan('WEEKLY_PASS', 'Wochenpass', 25, { expiryDurationDays: 7 }), plan('TRIAL_MEMBERSHIP', 'Probetraining', 0, { expiryDurationDays: 14 })];
  await db.membershipPlan.createMany({ data: plans });

  // Students: a realistic Verein mix.
  const st = [];
  for (let i = 0; i < nStudents; i++) {
    const r = rand();
    const age = r < 0.05 ? 2 + rand() * 2.5 : r < 0.35 ? 5 + rand() * 9 : r < 0.5 ? 14 + rand() * 3.5 : r < 0.93 ? 18.5 + rand() * 45 : 70 + rand() * 15;
    st.push(person({ age }));
  }
  return { key, school, branches, owner, instr1, instr2, bstaff, tOwner, disc, slots, nowClass, nowClassB2, futureClass, plans, students: st };
}

// --- School A: the Verein ---
const A = await setupSchool('A', `R5 DE Judo- und Karateverein Berlin-Lüdenscheidt e.V. ${RUN}`, ['Dojo Kreuzberg', 'Dojo Spandau'], 680);
const special = [
  person({ first: 'Friedrich-Wilhelm Maximilian Ferdinand Augustus', last: 'Freiherr von und zu Hohenzollern-Sigmaringen-Lüdenscheidt-Großkreutz-Wußmann' }),
  person({ first: 'Wolfgang', last: 'Straßenbahnfahrer-Weiß' }),
  person({ first: 'Nordin', last: '' }), // mononym
  person({ first: 'Mustafa', last: 'محمد العلي' }),
  person({ first: 'Jürgen', last: 'Müller' }), // combining umlauts (NFD)
  person({ first: 'Leni 🥋', last: 'Kraußer' }),
  person({ first: 'Eva', last: "D'Souza-Weißgerber" }),
  person({ first: 'Paul', last: 'Schaltjahr', dob: new Date('2012-02-29T00:00:00Z') }),
  person({ first: 'Hedwig', last: 'Großmutter', dob: yearsAgo(95) }),
  person({ first: 'Tobias', last: 'Rollstuhl-Becker', age: 31 }), // medical note
  person({ first: 'Lina', last: 'Bald-Achtzehn', dob: new Date(now - 18 * YEAR + 3 * DAY) }),
  person({ first: 'Jonas', last: 'Gestern-Achtzehn', dob: new Date(now - 18 * YEAR - 1 * DAY) }),
];
const shared = person({ first: 'Anna-Lena', last: 'von Brückner-Weiß', age: 33 }); // member at A, B and C
const kidAB = person({ first: 'Emil', last: 'Groß-Öztürk', age: 9 }); // child enrolled at A and B
const kidA = person({ first: 'Greta', last: 'Groß-Öztürk', age: 7 }); // sibling at A only
const kidB = person({ first: 'Karl', last: 'Groß-Öztürk', age: 12 }); // sibling at B only
const mother = person({ first: 'Sabine', last: 'Groß', age: 40 }); // Guardian at A only (divorced)
const father = person({ first: 'Murat', last: 'Öztürk', age: 42 }); // Guardian at A and B, also trains at A
await users([...A.students, ...special, shared, kidAB, kidA, kidB, mother, father]);
const allA = [...A.students, ...special, shared, kidAB, kidA, father];
await db.roleGrant.createMany({ data: allA.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: A.school.id, branchId: A.branches[i % 2].id })) });
// Guardians for under-16s in A: families of 1–3; mother & father special.
const kidsA = A.students.filter((u) => now - u.dateOfBirth.getTime() < 16 * YEAR);
const gA = []; const links = [];
for (let i = 0; i < kidsA.length;) { const n = 1 + Math.floor(rand() * 3); const g = person({ age: 38 }); gA.push(g); for (const k of kidsA.slice(i, i + n)) links.push({ id: randomUUID(), guardianId: g.id, studentId: k.id }); i += n; }
await users(gA);
await db.roleGrant.createMany({ data: [...gA, mother, father].map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: A.school.id })) });
links.push({ id: randomUUID(), guardianId: mother.id, studentId: kidAB.id }, { id: randomUUID(), guardianId: mother.id, studentId: kidA.id },
  { id: randomUUID(), guardianId: father.id, studentId: kidAB.id }, { id: randomUUID(), guardianId: father.id, studentId: kidA.id }, { id: randomUUID(), guardianId: father.id, studentId: kidB.id },
  { id: randomUUID(), guardianId: mother.id, studentId: special[7].id }, { id: randomUUID(), guardianId: mother.id, studentId: special[10].id });
await db.guardianLink.createMany({ data: links });
await db.consentRecord.createMany({ data: links.map((l) => ({ id: randomUUID(), guardianId: l.guardianId, studentId: l.studentId, tier: 'BASELINE', policyVersion: '1' })), skipDuplicates: true }).catch((e) => console.log('consent', e.message.slice(0, 200)));
// Memberships at A.
const [subAd, subKi, pack10, week, trial] = A.plans;
await db.membership.createMany({ data: allA.map((u) => {
  const kid = now - u.dateOfBirth.getTime() < 18 * YEAR; const r = rand();
  const p = r < 0.75 ? (kid ? subKi : subAd) : r < 0.88 ? pack10 : r < 0.94 ? week : trial;
  return { id: randomUUID(), studentId: u.id, schoolId: A.school.id, membershipPlanId: p.id, frequency: p.type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME', ...(p.type === 'CLASS_PACK' ? { classesRemaining: 10 } : {}), ...(p.expiryDurationDays ? { expiryDate: new Date(now + p.expiryDurationDays * DAY) } : {}) };
}) });
// A second Guardian staff: an adult who is also Branch Staff (the father trains too).

// --- School B: Potsdam (stands in for "another School") ---
const B = await setupSchool('B', `R5 DE Karate-Dojo Potsdam ${RUN}`, ['Dojo Babelsberg'], 40);
await users(B.students);
const allB = [...B.students, shared, kidAB, kidB];
await db.roleGrant.createMany({ data: allB.map((u) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: B.school.id, branchId: B.branches[0].id })) });
await db.roleGrant.create({ data: { id: randomUUID(), userId: father.id, role: 'GUARDIAN', schoolId: B.school.id } });
await db.membership.createMany({ data: allB.map((u) => ({ id: randomUUID(), studentId: u.id, schoolId: B.school.id, membershipPlanId: B.plans[0].id, frequency: 'RECURRING' })) });

// --- School C: to be closed and purged (has members' history) ---
const C = await setupSchool('C', `R5 DE Schließungstest Köpenick ${RUN}`, ['Halle Köpenick'], 20);
await users(C.students);
const kidC = person({ first: 'Pia', last: 'Köpenick-Kind', age: 8 }); const gC = person({ first: 'Uta', last: 'Köpenick', age: 39 });
await users([kidC, gC]);
const allC = [...C.students, shared, kidC];
await db.roleGrant.createMany({ data: [...allC.map((u) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: C.school.id, branchId: C.branches[0].id })), { id: randomUUID(), userId: gC.id, role: 'GUARDIAN', schoolId: C.school.id }] });
await db.guardianLink.create({ data: { id: randomUUID(), guardianId: gC.id, studentId: kidC.id } });
await db.consentRecord.create({ data: { id: randomUUID(), guardianId: gC.id, studentId: kidC.id, tier: 'BASELINE', policyVersion: '1' } });
await db.membership.createMany({ data: allC.map((u) => ({ id: randomUUID(), studentId: u.id, schoolId: C.school.id, membershipPlanId: C.plans[0].id, frequency: 'RECURRING' })) });

// --- School D: no members' history at all ---
const D = await setupSchool('D', `R5 DE Leere Schule ${RUN}`, ['Halle'], 0);

// Medical info (stored at sign-up in real life; straight into the DB here).
const med = (schoolId, studentId, body, byG = null) => ({ id: randomUUID(), schoolId, studentId, body, consentedById: byG ?? studentId, consentedByGuardian: !!byG, consentedAt: new Date() });
await db.studentMedicalInfo.createMany({ data: [
  med(A.school.id, shared.id, 'A-MED: Asthma, Inhalator in der Tasche'), med(B.school.id, shared.id, 'B-MED: Knie-OP 2024'), med(C.school.id, shared.id, 'C-MED: Diabetes Typ 1'),
  med(A.school.id, kidAB.id, 'A-MED-KID: Erdnussallergie', mother.id), med(A.school.id, special[9].id, 'Rollstuhl, Querschnitt ab Th12'),
  med(C.school.id, kidC.id, 'C-MED-KID: Epilepsie', gC.id),
] });

const tok = (u, g) => tokenRca(u, g);
const S = (x) => ({ id: x.school.id, name: x.school.name, branches: x.branches.map((b) => b.id), owner: { id: x.owner.id, email: x.owner.email, tok: x.tOwner }, staff: { id: x.bstaff.id, email: x.bstaff.email, tok: tok(x.bstaff, [grant('BRANCH_STAFF', x.school.id, x.branches[0].id)]) }, instr: [x.instr1.id, x.instr2.id], instrTok: tok(x.instr1, [grant('INSTRUCTOR', x.school.id, x.branches[0].id)]), disc: x.disc, slots: x.slots, nowClass: x.nowClass, nowClassB2: x.nowClassB2, futureClass: x.futureClass, plans: Object.fromEntries(x.plans.map((p) => [p.title, p.id])) });
const cast = {
  run: RUN, pass: PASS, A: S(A), B: S(B), C: S(C), D: S(D),
  studentsA: allA.map((u, i) => ({ id: u.id, name: `${u.firstName} ${u.surname}`, branch: A.branches[i % 2].id, tok: tok(u, [grant('STUDENT', A.school.id, A.branches[i % 2].id)]) })),
  studentsB: B.students.map((u) => ({ id: u.id, tok: tok(u, [grant('STUDENT', B.school.id, B.branches[0].id)]) })),
  studentsC: C.students.map((u) => ({ id: u.id, tok: tok(u, [grant('STUDENT', C.school.id, C.branches[0].id)]) })),
  special: special.map((u) => ({ id: u.id, name: `${u.firstName} ${u.surname}` })),
  shared: { id: shared.id, email: shared.email, tok: tok(shared, [grant('STUDENT', A.school.id, A.branches[0].id), grant('STUDENT', B.school.id, B.branches[0].id), grant('STUDENT', C.school.id, C.branches[0].id)]) },
  kidAB: kidAB.id, kidA: kidA.id, kidB: kidB.id, kidC: kidC.id,
  mother: { id: mother.id, tok: tok(mother, [grant('GUARDIAN', A.school.id)]) },
  father: { id: father.id, tok: tok(father, [grant('GUARDIAN', A.school.id), grant('GUARDIAN', B.school.id), grant('STUDENT', A.school.id, A.branches[1].id)]) },
  gC: { id: gC.id, tok: tok(gC, [grant('GUARDIAN', C.school.id)]) },
  guardiansA: gA.length,
};
fs.writeFileSync(new URL('./cast-de.json', import.meta.url), JSON.stringify(cast));
console.log({ run: RUN, A: allA.length, guardiansA: gA.length + 2, kidsA: kidsA.length, B: allB.length, C: allC.length, schools: [A.school.name, B.school.name, C.school.name, D.school.name] });
await db.$disconnect();
