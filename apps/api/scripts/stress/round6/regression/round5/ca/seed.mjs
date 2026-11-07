// Round 5, Canada: Marie-Ève Tremblay's BJJ academy (Vancouver + Montréal).
// Users, grants, guardian links and some memberships go straight into the DB
// (as round4/world.mjs does); payment account, plans, styles and timetable go
// through the API. Writes cast-ca.json next to this file.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';
import { makeStripeAccountReady } from '../../booking-schedule/lib.mjs';

const now = Date.now();
const DAY = 86400e3, YEAR = 365.25 * DAY;
let rnd = 777; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
let k = 0; const RUN = Date.now().toString(36); const PH = 1000000 + Math.floor(Math.random() * 8000000);
const FIRST = ['Émile', 'Chloé', 'Liam', 'Hélène', 'François', 'Anaïs', 'Zoé', 'Noémie', 'Jérôme', 'Gaëlle', 'Ève', 'Maëlle', 'Raphaël', 'Thérèse', 'Benoît', 'Ophélie', 'Noah', 'Olivia', 'Siobhan', 'Arjun', 'Mei', 'Kwame'];
const LAST = ['Tremblay', 'Gagnon', 'Roy', 'Côté', 'Bouchard', 'Gauthier', 'Morin', 'Lavoie', 'Fortin', 'Gagné', "O'Reilly", "D'Amours", 'Lefèbvre', 'Garçon', 'Beaulieu-Préfontaine', 'Ouellet', 'Bélanger', 'Lévesque', 'Çelik', 'Nguyễn', 'Smith', 'MacDonald'];
const user = (o = {}) => {
  const n = k++;
  const { first = pick(FIRST), last = pick(LAST), age = 18.5 + rand() * 45, dob } = o;
  return {
    id: randomUUID(), email: o.email || `r5-ca-${RUN}-${n}@stress.test`, phone: `+1236${PH + n}`,
    firstName: first, surname: last, passcodeHash: 'x', phoneVerifiedAt: new Date(),
    dateOfBirth: dob || new Date(now - age * YEAR), language: rand() < 0.4 ? 'fr' : 'en-GB', currency: 'CAD',
    gender: rand() < 0.5 ? 'FEMALE' : 'MALE',
  };
};

const school = await db.school.create({ data: {
  id: randomUUID(), name: 'R5 CA Académie Tremblay Jiu-Jitsu', timezone: 'America/Vancouver', ranksToggle: true,
  defaultCurrency: 'CAD', defaultLanguage: 'en-GB', addressCountry: 'CA', addressCity: 'Vancouver', addressRegion: 'BC', address: '1234 Rue Commercial Dr', addressPostalCode: 'V5L 3X1',
  waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), weekStartsOn: 'SUNDAY',
} });
const van = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Vancouver – Commercial Drive', addressCountry: 'CA', addressCity: 'Vancouver', addressRegion: 'BC' } });
const mtl = await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Montréal – Plateau', timezone: 'America/Toronto', addressCountry: 'CA', addressCity: 'Montréal', addressRegion: 'QC' } });
const branches = [van, mtl];

// Staff: owner Marie-Ève, a co-owner, 4 instructors (one also trains), 2 branch staff.
const owner = user({ first: 'Marie-Ève', last: 'Tremblay', age: 41, email: `r5-ca-${RUN}-owner@stress.test` });
const coOwner = user({ first: 'Jean-François', last: 'Lévesque', age: 44, email: `r5-ca-${RUN}-coowner@stress.test` });
const instr = [user({ first: 'Hélène', last: 'Côté' }), user({ first: 'Luc', last: 'Garçon' }), user({ first: 'Rafael', last: 'Gracie' }), user({ first: 'Ève', last: "D'Amours" })];
const bstaff = [user({ first: 'Noémie', last: 'Ouellet' }), user({ first: 'Kwame', last: 'Mensah' })];
const staff = [owner, coOwner, ...instr, ...bstaff];
await db.user.createMany({ data: staff });
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
  ...instr.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[i % 2].id })),
  ...bstaff.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: branches[i % 2].id })),
  { id: randomUUID(), userId: instr[0].id, role: 'STUDENT', schoolId: school.id, branchId: van.id }, // instructor who trains
] });
await db.instructor.createMany({ data: instr.map((u, i) => ({ id: randomUUID(), userId: u.id, schoolId: school.id, branchId: branches[i % 2].id })) });
const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);

// Special people.
const NFD = 'Hélène'; // Hélène with combining accents
const specials = [
  user({ first: 'Hélène', last: 'Ç' + 'ôté-Lefèbvre' }), user({ first: NFD, last: 'Beaulieu' }),
  user({ first: 'Ç', last: 'Garçon' }), user({ first: 'Zoë-Maëlle', last: "O'Reilly-D'Amours" }),
  user({ first: 'Marie-Ève-Geneviève-Anne-Thérèse-Bernadette-Joséphine-Françoise-Noëlle-Clémence-Apolline', last: 'de la Fontaine-Beaulieu-Préfontaine-Lévesque' }),
  user({ first: 'Kanaan', last: '-' }), user({ first: '🥋 Émoji', last: 'Gaëtan 🇨🇦' }), user({ first: 'مريم', last: 'الحسيني' }),
  user({ first: 'Léap', last: 'Year', dob: new Date('2008-02-29T08:00:00Z') }), user({ first: 'Thérèse', last: 'Doyenne', age: 95.3 }),
  user({ first: 'Gérard', last: 'Senior', age: 72 }), user({ first: 'Ophélie', last: 'Médical', age: 30 }),
  user({ first: "Robert'); DROP TABLE \"User\";--", last: '<script>alert(1)</script>' }),
  user({ first: 'Turning', last: 'Eighteen', dob: new Date(now - 18 * YEAR + 3 * DAY) }), user({ first: 'Just', last: 'Turned', dob: new Date(now - 18 * YEAR - 1 * DAY) }),
];
// Bulk adults and teens.
const adults = Array.from({ length: 430 }, () => user());
const teens = Array.from({ length: 40 }, () => user({ age: 13 + rand() * 4.5 }));
const kids = Array.from({ length: 70 }, () => user({ age: 2.2 + rand() * 9 }));
const students = [...specials, ...adults, ...teens, ...kids];
await db.user.createMany({ data: students });
await db.roleGrant.createMany({ data: students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id, branchId: branches[i % 3 === 2 ? 1 : 0].id })) });
// Guardians: families of 1-3 kids; one guardian also trains; one child with two (divorced) guardians.
const gs = Array.from({ length: 40 }, () => user({ age: 30 + rand() * 15 }));
await db.user.createMany({ data: gs });
await db.roleGrant.createMany({ data: gs.map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })) });
await db.roleGrant.create({ data: { id: randomUUID(), userId: gs[0].id, role: 'STUDENT', schoolId: school.id, branchId: van.id } });
const links = []; let ki = 0;
gs.forEach((g, i) => { const n = 1 + (i % 3); for (let j = 0; j < n && ki < kids.length; j++) links.push({ id: randomUUID(), guardianId: g.id, studentId: kids[ki++].id }); });
links.push({ id: randomUUID(), guardianId: gs[1].id, studentId: kids[0].id }); // second (divorced) parent
links.push({ id: randomUUID(), guardianId: gs[2].id, studentId: teens[0].id });
await db.guardianLink.createMany({ data: links, skipDuplicates: true });

// Payment account (Stripe Connect against the fake) and settings through the API.
const acct = await call('seed:pa', 'POST', `/schools/${school.id}/payment-accounts`, tOwner, { provider: 'STRIPE', accountTitle: 'Compte principal', country: 'CA' });
if (acct.status >= 300) throw new Error('pa ' + JSON.stringify(acct.body));
let ob; for (let a = 0; a < 5; a++) { ob = await call('seed:onboard', 'POST', `/payment-accounts/${acct.body.id}/connect/onboard`, tOwner, {}); if (ob.status < 300) break; console.log('onboard retry', ob.status); await new Promise((r) => setTimeout(r, 1500)); }
if (ob.status >= 300) throw new Error('onboard ' + JSON.stringify(ob.body));
// Round 6 adaptation (Decision 442 item 2): Stripe says the account is ready.
{ const pa = await db.paymentAccount.findUnique({ where: { id: acct.body.id } }); if (!pa.stripeAccountReady) await makeStripeAccountReady(pa.stripeConnectedAccountId); }
const pa = await db.paymentAccount.findUnique({ where: { id: acct.body.id } });

// Style and timetable.
const disc = await call('seed:style', 'POST', `/schools/${school.id}/disciplines/from-template`, tOwner, { templateId: 'ibjjf', name: 'BJJ' });
if (disc.status >= 300) throw new Error('style ' + JSON.stringify(disc.body));
const d = await db.discipline.findUnique({ where: { id: disc.body.id } });
const styles = [{ disciplineId: d.id, classType: (d.classTypesOffered || [])[0] ?? null }];
const slots = [];
for (const [b, i, day, s, e] of [[van, instr[0], 'MONDAY', '18:00', '19:30'], [van, instr[2], 'WEDNESDAY', '12:00', '13:00'], [van, instr[0], 'SATURDAY', '10:00', '11:30'], [mtl, instr[1], 'TUESDAY', '19:00', '20:30'], [mtl, instr[3], 'THURSDAY', '06:30', '07:30'], [mtl, instr[1], 'FRIDAY', '23:30', '00:30']]) {
  const r = await call('seed:slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: b.id, instructorId: i.id, weekday: day, startTime: s, endTime: e, title: `BJJ ${s}`, styles, capacity: 30 });
  slots.push({ status: r.status, id: r.body?.id, err: r.status >= 300 ? r.body : undefined, day, s, e, branch: b.name });
}

// Plans through the API (CAD, minor units).
const plans = {};
for (const [key, body] of Object.entries({
  monthly: { type: 'SUBSCRIPTION', title: 'Illimité mensuel / Unlimited monthly', price: 18900, cancellationCharge: 1500 },
  family: { type: 'SUBSCRIPTION', title: 'Famille — Enfants', price: 12900 },
  decline: { type: 'SUBSCRIPTION', title: 'Declines (ends in 13)', price: 10013 },
  pack10: { type: 'CLASS_PACK', title: '10 cours', price: 25000, classesIncluded: 10, expiryDurationDays: 120, cancellationCharge: 1000 },
  week: { type: 'WEEKLY_PASS', title: 'Semaine / Week pass', price: 4500, expiryDurationDays: 7 },
  trial: { type: 'TRIAL_MEMBERSHIP', title: 'Essai gratuit', price: 0, expiryDurationDays: 14 },
  friend: { type: 'FRIEND_PASS', title: 'Passe ami', price: 0, classesIncluded: 1 },
})) {
  const r = await call('seed:plan', 'POST', `/schools/${school.id}/membership-plans`, tOwner, { currency: 'CAD', ...body });
  if (r.status >= 300) throw new Error('plan ' + key + JSON.stringify(r.body));
  plans[key] = r.body.id;
}
// Background members: packs for 120 adults via DB (subscriptions get made through the API in money.mjs).
const ms = adults.slice(300, 420).map((u) => ({ id: randomUUID(), studentId: u.id, schoolId: school.id, membershipPlanId: plans.pack10, frequency: 'ONE_TIME', classesRemaining: 10, expiryDate: new Date(now + 100 * DAY) }));
await db.membership.createMany({ data: ms });

const mk = (u, role, branchId) => ({ id: u.id, email: u.email, name: `${u.firstName} ${u.surname}`, tok: tokenRca(u, [grant(role, school.id, branchId)]) });
const cast = {
  schoolId: school.id, van: van.id, mtl: mtl.id, acct: pa.stripeConnectedAccountId, paymentAccountId: pa.id, disciplineId: d.id, slots, plans,
  owner: mk(owner, 'SCHOOL_OWNER_MANAGER'), coOwner: mk(coOwner, 'SCHOOL_OWNER_MANAGER'), instr: instr.map((u, i) => mk(u, 'INSTRUCTOR', branches[i % 2].id)),
  bstaff: bstaff.map((u, i) => mk(u, 'BRANCH_STAFF', branches[i % 2].id)),
  specials: specials.map((u) => ({ ...mk(u, 'STUDENT', van.id), first: u.firstName, last: u.surname })),
  adults: adults.map((u, i) => mk(u, 'STUDENT', branches[(i + 15) % 3 === 2 ? 1 : 0].id)),
  teens: teens.map((u) => mk(u, 'STUDENT', van.id)), kids: kids.map((u) => u.id),
  guardians: gs.map((g) => ({ ...mk(g, 'GUARDIAN'), kids: links.filter((l) => l.guardianId === g.id).map((l) => l.studentId) })),
};
fs.writeFileSync(new URL('./cast-ca.json', import.meta.url), JSON.stringify(cast, null, 1));
console.log({ school: school.id, people: staff.length + students.length + gs.length, students: students.length, guardians: gs.length, slots: slots.map((s) => `${s.branch} ${s.day} ${s.s} ${s.status}`), plans: Object.keys(plans) });
await db.$disconnect();
