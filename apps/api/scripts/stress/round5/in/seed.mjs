// Round 5, India (Priya Ramachandran): one very large taekwondo academy,
// 8 Branches, ~4,000 students. Users/grants/links/memberships straight into the
// DB (as round4/world.mjs); disciplines, timetable and classes via the API.
// Writes in-cast.json next to this file.
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const N = Number(process.env.N || 4000);
const now = Date.now();
const YEAR = 365.25 * 86400e3;
let rnd = 917; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const day = (d) => new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z');
const RUN = process.env.RUN || String(Date.now()).slice(-6);

// Names as an Indian academy really has them.
const LATIN = [['Aarav', 'Sharma'], ['Ananya', 'Iyer'], ['Priya', 'Ramachandran'], ['Rohan', 'Singh'], ['Divya', 'Nair'], ['Arjun', 'Reddy'], ['Meenakshi', 'Sundaram'], ['Karthik', 'Subramanian'], ['Lakshmi', 'Venkatesh'], ['Siddharth', 'Menon'], ['Fatima', 'Shaikh'], ['Gurpreet', 'Kaur'], ['Joseph', "D'Souza"], ['Anil', 'Kumar'], ['Sneha', 'Patil']];
const INITIALS = [['K. R. Venkataraghavan', 'Subramanian'], ['S. Lakshmi', 'Narayanan'], ['A. P. J.', 'Abdul Kalam'], ['M.K.', 'Stalin'], ['R', 'Ashwin'], ['T. M. Krishna', 'Iyer']];
const DEVA = [['आरव', 'शर्मा'], ['अनन्या', 'गुप्ता'], ['ज़ोया', 'ख़ान'], ['प्रिया', 'सिंह'], ['रोहन', 'वर्मा']];
const TAMIL = [['கார்த்திக்', 'சுப்பிரமணியன்'], ['மீனாட்சி', 'சுந்தரம்'], ['வெங்கடராகவன்', 'ராமன்'], ['லட்சுமி', 'நாராயணன்']];
// Mononyms: the product requires a surname, so families type the name twice, an initial, or "."
const MONO = [['Venkataraghavan', '.'], ['Suriya', 'Suriya'], ['Kamala', 'K'], ['Ilaiyaraaja', '-']];
function nameFor(i) {
  const r = rand();
  if (r < 0.55) return pick(LATIN);
  if (r < 0.70) return pick(INITIALS);
  if (r < 0.80) return pick(DEVA);
  if (r < 0.90) return pick(TAMIL);
  if (r < 0.95) return pick(MONO);
  return [pick(LATIN)[0], pick(LATIN)[1] + '-' + pick(LATIN)[1]];
}
let seq = 0;
const phoneOf = (k) => `+9198${String(RUN).padStart(6, '0').slice(-4)}${String(k).padStart(4, '0')}`;
function mkUser(opts = {}) {
  const k = seq++;
  const [first, last] = opts.name || nameFor(k);
  const r = rand();
  const dob = opts.dob || (r < 0.05 ? new Date(now - (2 + rand() * 2) * YEAR) : r < 0.40 ? new Date(now - (5 + rand() * 8) * YEAR) : r < 0.55 ? new Date(now - (13 + rand() * 4.5) * YEAR) : r < 0.97 ? new Date(now - (18.3 + rand() * 40) * YEAR) : new Date(now - (60 + rand() * 25) * YEAR));
  return { id: randomUUID(), email: `r5-in-${RUN}-${k}@stress.test`, phone: opts.noPhone ? null : phoneOf(k), firstName: first, surname: last, passcodeHash: 'x', dateOfBirth: day(dob), phoneVerifiedAt: new Date(), language: 'en', currency: 'INR', gender: r < 0.48 ? 'FEMALE' : 'MALE' };
}

const school = await db.school.create({ data: {
  id: randomUUID(), name: `R5 IN Priya Taekwondo Academy ${RUN}`, timezone: 'Asia/Kolkata', ranksToggle: true, defaultCurrency: 'INR', defaultLanguage: 'en',
  addressCountry: 'IN', addressCity: 'Chennai', waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), taxCountry: 'IN', weekStartsOn: 'MONDAY',
} });
const BR = ['Adyar', 'T. Nagar', 'Velachery', 'Coimbatore', 'Madurai', 'Bengaluru Indiranagar', 'Mumbai Andheri', 'Delhi Dwarka'];
const branches = [];
for (const b of BR) branches.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: b, addressCountry: 'IN' } }));

const staffU = Array.from({ length: 2 + 8 + 8 }, () => mkUser({ dob: new Date(now - 35 * YEAR) }));
await db.user.createMany({ data: staffU });
const [owner, coOwner] = staffU; const bstaff = staffU.slice(2, 10); const instr = staffU.slice(10, 18);
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
  ...bstaff.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: branches[i].id })),
  ...instr.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[i].id })),
] });
await db.instructor.createMany({ data: instr.map((u, i) => ({ id: randomUUID(), userId: u.id, schoolId: school.id, branchId: branches[i].id })) });
const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);

const disc = await call('seed:discipline', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: 'Taekwondo' });
if (disc.status >= 300) throw new Error('disc ' + JSON.stringify(disc.body));
const styles = [{ disciplineId: disc.body.id, classType: null }];
// Timetable with half-hour local times and one across midnight.
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TIMES = [['06:30', '07:30'], ['17:30', '18:30'], ['19:00', '20:30']];
const slots = []; const slotErr = [];
for (let b = 0; b < 8; b++) for (const d of DAYS.slice(0, 6)) for (const t of TIMES) {
  const r = await call('seed:slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: branches[b].id, instructorId: instr[b].id, weekday: d, startTime: t[0], endTime: t[1], title: `Taekwondo ${t[0]}`, styles, capacity: 60 });
  if (r.status >= 300) slotErr.push(r.body); else slots.push(r.body.id);
}
const midnight = await call('seed:slot-midnight', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: branches[0].id, instructorId: instr[0].id, weekday: 'SATURDAY', startTime: '23:30', endTime: '00:30', title: 'Night sparring', styles, capacity: 30 });

// Plans in INR, stored in paise.
const plan = (type, title, rupees, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: rupees * 100, currency: 'INR', ...extra });
const plans = [plan('SUBSCRIPTION', 'Monthly unlimited', 2500), plan('CLASS_PACK', '10-class pack', 3000, { classesIncluded: 10, expiryDurationDays: 90 }), plan('WEEKLY_PASS', 'Week pass', 800, { expiryDurationDays: 7 }), plan('TRIAL_MEMBERSHIP', 'Free trial', 0, { expiryDurationDays: 14 })];
await db.membershipPlan.createMany({ data: plans });

// Students.
const special = [
  mkUser({ name: ['Venkataraghavan', '.'], dob: new Date(now - 30 * YEAR) }),
  mkUser({ name: ['K. R. Venkataraghavan Subramanian Iyer Ramaswamy Natarajan Krishnamurthy Sundararajan Padmanabhan Ra', 'Ramachandran'], dob: new Date(now - 40 * YEAR) }),
  mkUser({ name: ['அம்மா', 'பாட்டி'], dob: new Date(now - 95 * YEAR) }),
  mkUser({ name: ['Leap', 'Day'], dob: new Date('2012-02-29T00:00:00Z') }),
  mkUser({ name: ['Turning', 'EighteenSoon'], dob: day(new Date(now - 18 * YEAR + 3 * 86400e3)) }),
  mkUser({ name: ['Turned', 'EighteenYesterday'], dob: day(new Date(now - 18 * YEAR - 1 * 86400e3)) }),
  mkUser({ name: ['ज़ोया', 'ख़ान'], dob: new Date(now - 25 * YEAR) }), // precomposed nukta (U+095B, U+0959)
];
const students = [...special, ...Array.from({ length: N - special.length }, () => mkUser())];
// Children carry no phone of their own.
for (const s of students) if (now - s.dateOfBirth.getTime() < 18 * YEAR) s.phone = null;
for (let i = 0; i < students.length; i += 2000) await db.user.createMany({ data: students.slice(i, i + 2000) });
const brOf = (i) => branches[i % 8];
await db.roleGrant.createMany({ data: students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id, branchId: brOf(i).id })) });
// Home branch for all but every 50th (joined via app without choosing).
await db.studentHomeBranch.createMany({ data: students.map((u, i) => i % 50 === 49 ? null : { id: randomUUID(), schoolId: school.id, studentId: u.id, branchId: brOf(i).id }).filter(Boolean) });
const ms = students.map((u, i) => {
  const r = rand();
  const base = { id: randomUUID(), studentId: u.id, schoolId: school.id };
  if (r < 0.75) return { ...base, membershipPlanId: plans[0].id, frequency: 'RECURRING' };
  if (r < 0.9) return { ...base, membershipPlanId: plans[1].id, frequency: 'ONE_TIME', classesRemaining: 10, expiryDate: new Date(now + 60 * 86400e3) };
  return null;
}).filter(Boolean);
await db.membership.createMany({ data: ms });

// Guardians: siblings share one Guardian; two Guardians for some children; one Guardian also trains.
const kids = students.filter((u) => now - u.dateOfBirth.getTime() < 16 * YEAR);
const fams = []; for (let i = 0; i < kids.length * 0.6;) { const n = 1 + Math.floor(rand() * 3); fams.push(kids.slice(i, i + n)); i += n; }
const gU = fams.map(() => mkUser({ dob: new Date(now - 40 * YEAR) }));
await db.user.createMany({ data: gU });
await db.roleGrant.createMany({ data: gU.map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })) });
const links = fams.flatMap((f, i) => f.map((k) => ({ id: randomUUID(), guardianId: gU[i].id, studentId: k.id })));
// second Guardian (other parent) for the first 20 families
const g2 = fams.slice(0, 20).map(() => mkUser({ dob: new Date(now - 42 * YEAR) }));
await db.user.createMany({ data: g2 });
await db.roleGrant.createMany({ data: g2.map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })) });
g2.forEach((g, i) => fams[i].forEach((k) => links.push({ id: randomUUID(), guardianId: g.id, studentId: k.id })));
await db.guardianLink.createMany({ data: links });
await db.roleGrant.create({ data: { id: randomUUID(), userId: gU[0].id, role: 'STUDENT', schoolId: school.id, branchId: branches[0].id } });

const cast = {
  run: RUN, schoolId: school.id, branches: branches.map((b) => b.id), branchNames: BR, disciplineId: disc.body.id, styles,
  owner: { id: owner.id, email: owner.email }, coOwner: { id: coOwner.id, email: coOwner.email },
  bstaff: bstaff.map((u, i) => ({ id: u.id, email: u.email, branchId: branches[i].id })), instr: instr.map((u, i) => ({ id: u.id, email: u.email, branchId: branches[i].id })),
  plans: Object.fromEntries(plans.map((p) => [p.title, p.id])), slots: slots.length, slotErr, midnight: { status: midnight.status, body: midnight.body },
  students: students.map((u, i) => ({ id: u.id, email: u.email, branch: brOf(i).id, home: i % 50 !== 49, first: u.firstName, last: u.surname, dob: u.dateOfBirth.toISOString().slice(0, 10), phone: u.phone })),
  guardians: gU.map((g, i) => ({ id: g.id, email: g.email, kids: fams[i].map((k) => k.id) })),
};
fs.writeFileSync(new URL('./in-cast.json', import.meta.url), JSON.stringify(cast));
console.log({ school: school.id, students: students.length, guardians: gU.length + g2.length, slots: slots.length, slotErr: slotErr.slice(0, 2), midnight: midnight.status, mbody: JSON.stringify(midnight.body).slice(0, 200) });
await db.$disconnect();
