// Round 4, phase 1: the world. 500 Schools in about 40 countries, sizes like real
// life, 15 Franchises (one across three countries), Guardians with several
// children, people with more than one role. Writes cast.json in the round 1
// format (so the round 1–3 scripts run against it unchanged), plus the extra
// fields round 4 needs.
//
//   N_SCHOOLS   default 500        CONCURRENCY  Schools seeded at once (default 6)
//
// Like round 1: Schools, users, role grants, Guardian links and memberships go
// straight into the database (sign-up needs SMS, purchases need Stripe).
// Styles, timetable slots, one-off classes, plans' Stripe-free fields and the
// class generator go through the API.
import fs from 'fs';
import { db, call, pool, grant, randomUUID, report, Queue } from '../booking-schedule/lib.mjs';
import { COUNTRIES, nameFor, phoneFor, addressFor } from './countries.mjs';
import { createRequire } from 'module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { JwtService } = require('@nestjs/jwt');
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
// Long-lived (the run takes hours). No `rca` claim, like rounds 1–3: the scripts
// that test instant role changes sign their own tokens with one.
export const tok = (user, grants) => jwt.sign({ sub: user.id, email: user.email, grants }, { expiresIn: '72h' });

const N_SCHOOLS = Number(process.env.N_SCHOOLS || 500);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
let rnd = 4242; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pickOne = (a) => a[Math.floor(rand() * a.length)];
const now = Date.now();
const YEAR = 365.25 * 86400e3;

// Size bands: [share, label, students min-max, branches min-max, staff min-max, slots min-max]
const BANDS = [
  [0.60, 'small', 15, 80, 1, 1, 0, 1, 5, 15],
  [0.28, 'medium', 100, 400, 1, 2, 2, 6, 15, 40],
  [0.10, 'large', 500, 1200, 2, 4, 4, 10, 40, 80],
  [0.02, 'xlarge', 3000, 4000, 5, 10, 10, 20, 80, 120],
];
function bandFor(i) {
  // Deterministic: every 50 Schools hold 30 small, 14 medium, 5 large, 1 very large.
  const k = i % 50;
  return k === 0 ? BANDS[3] : k <= 5 ? BANDS[2] : k <= 19 ? BANDS[1] : BANDS[0];
}

const DISCIPLINES = ['Judo', 'Karate', 'Muay Thai', 'Taekwondo', 'Boxing', 'Kids Jiu-Jitsu', 'Wrestling', 'Capoeira'];

let seq = 0;
async function mkUsers(n, country, opts = {}) {
  const rows = Array.from({ length: n }, () => {
    const k = seq++;
    const { first, last } = nameFor(country, rand);
    const r = rand();
    // 22% children (6–15), 3% turning 18 within the next 8 weeks, the rest adults.
    const dob = opts.adult ? new Date(now - (25 + rand() * 30) * YEAR)
      : r < 0.22 ? new Date(now - (6 + rand() * 9.5) * YEAR)
      : r < 0.25 ? new Date(now - 18 * YEAR + rand() * 56 * 86400e3)
      : new Date(now - (18.2 + rand() * 45) * YEAR);
    return {
      id: randomUUID(), email: `r4-${k}@stress.test`, phone: phoneFor(country, k), firstName: first, surname: last,
      passcodeHash: 'x', dateOfBirth: dob, phoneVerifiedAt: new Date(), language: country.lang, currency: country.currency,
      gender: r < 0.45 ? 'FEMALE' : r < 0.9 ? 'MALE' : null,
    };
  });
  for (let i = 0; i < rows.length; i += 2000) await db.user.createMany({ data: rows.slice(i, i + 2000) });
  return rows;
}

// --- Franchises: 15, 3–20 Schools each; franchise 0 spans three countries. ---
const franchises = [];
const fCountries = [['BR', 'PT', 'US'], ['US'], ['GB'], ['BR'], ['AE'], ['ES'], ['MX'], ['AU'], ['JP'], ['FR'], ['DE'], ['US'], ['BR'], ['GB'], ['TH']];
for (let f = 0; f < 15; f++) {
  const fr = await db.franchise.create({ data: { id: randomUUID(), name: `R4 Franchise ${f + 1}`, addressCountry: fCountries[f][0] } });
  franchises.push({ id: fr.id, countries: fCountries[f], size: 3 + ((f * 7) % 18), schools: [] });
}
// Assign School slots to franchises up front (deterministic), the rest independent.
const fAssign = new Array(N_SCHOOLS).fill(null);
{ let i = 7; for (const fr of franchises) for (let k = 0; k < fr.size && i < N_SCHOOLS; k++, i += 3) fAssign[i % N_SCHOOLS] = fr; }

const cast = { round: 4, schools: [], franchises: [], guardians: [] };
const t0 = Date.now();
let done = 0;

async function seedSchool(s) {
  const fr = fAssign[s];
  const country = fr ? COUNTRIES.find((c) => c.cc === fr.countries[s % fr.countries.length]) || COUNTRIES[0] : COUNTRIES[s % COUNTRIES.length];
  const band = bandFor(s);
  const [, size, sMin, sMax, bMin, bMax, stMin, stMax, slMin, slMax] = band;
  const tz = country.tz[s % country.tz.length];
  const addr = addressFor(country, rand);
  const school = await db.school.create({ data: {
    id: randomUUID(), name: `${country.schoolWord} ${nameFor(country, rand).last} ${s + 1}`, timezone: tz, ranksToggle: true,
    defaultCurrency: country.currency, defaultLanguage: country.lang, addressCountry: country.cc, ...addr,
    franchiseId: fr ? fr.id : null, waitlistClaimWindowMinutes: 60,
    classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(),
    taxCountry: country.cc, weekStartsOn: country.weekStart || 'MONDAY',
  } });
  const nBranches = ri(bMin, bMax);
  const branches = [];
  for (let b = 0; b < nBranches; b++) {
    // A US School's later Branches sit in other US time zones (Branch timezone override).
    const btz = country.tz.length > 1 && b > 0 ? country.tz[(s + b) % country.tz.length] : null;
    branches.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: b === 0 ? 'Main' : `Branch ${b + 1}`, timezone: btz, addressCountry: country.cc, ...addressFor(country, rand) } }));
  }
  // Owner (also trains at 1 in 5 Schools), instructors, Branch Staff.
  const nStaff = ri(stMin, stMax);
  const nInstr = Math.max(1, Math.ceil(nStaff / 2));
  const staffUsers = await mkUsers(2 + nInstr + Math.max(1, nStaff - nInstr), country, { adult: true });
  const [owner, coOwner] = staffUsers;
  const instructors = staffUsers.slice(2, 2 + nInstr);
  const bstaff = staffUsers.slice(2 + nInstr);
  const grants = [
    { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, isMainOwner: true },
    ...(size !== 'small' ? [{ id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }] : []),
    ...instructors.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[i % nBranches].id })),
    ...bstaff.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: branches[i % nBranches].id })),
  ];
  if (s % 5 === 0) grants.push({ id: randomUUID(), userId: owner.id, role: 'STUDENT', schoolId: school.id, branchId: branches[0].id });
  await db.roleGrant.createMany({ data: grants });
  await db.instructor.createMany({ data: instructors.map((u, i) => ({ id: randomUUID(), userId: u.id, schoolId: school.id, branchId: branches[i % nBranches].id })) });
  const tOwner = tok(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
  const tInstr = tok(instructors[0], [grant('INSTRUCTOR', school.id, branches[0].id)]);
  const tStaff = tok(bstaff[0], [grant('BRANCH_STAFF', school.id, branches[0].id)]);

  // Styles: BJJ from the IBJJF template, plus 0–5 other disciplines (some Levels-only).
  const tpl = ['ibjjf', 'ibjjf_kids_red', 'ibjjf_kids_yellow'][s % 3];
  const disc = await call('seed:style-template', 'POST', `/schools/${school.id}/disciplines/from-template`, tOwner, { templateId: tpl, name: 'BJJ' });
  if (disc.status >= 300) throw new Error('template ' + JSON.stringify(disc.body));
  const discipline = await db.discipline.findUnique({ where: { id: disc.body.id } });
  const classType = (discipline.classTypesOffered || [])[0] ?? null;
  const styles = [{ disciplineId: discipline.id, classType }];
  const extraDisc = [];
  const nExtra = size === 'small' ? ri(0, 1) : ri(1, 5);
  for (let d = 0; d < nExtra; d++) {
    const r = await call('seed:discipline', 'POST', `/schools/${school.id}/disciplines`, tOwner, { name: DISCIPLINES[(s + d) % DISCIPLINES.length] });
    if (r.status < 300) extraDisc.push(r.body.id);
  }

  // Timetable: slMin–slMax weekly slots over the Branches, instructors rotating.
  const nSlots = ri(slMin, slMax);
  const times = [['06:30', '07:30'], ['07:00', '08:00'], ['12:00', '13:00'], ['17:00', '18:00'], ['18:00', '19:00'], ['18:30', '20:00'], ['19:30', '21:00'], ['20:00', '21:30'], ['10:00', '11:30'], ['16:00', '16:45']];
  const slots = [];
  const slotSpecs = [];
  // A slot's instructor must hold the INSTRUCTOR grant at the slot's Branch.
  for (let k = 0; k < nSlots; k++) { const ii = Math.floor(k / 3) % nInstr; slotSpecs.push({ d: DAYS[k % 7], t: times[Math.floor(k / 7) % times.length], b: branches[ii % nBranches], i: instructors[ii] }); }
  // Round 1 scripts expect the first 14 slots on Branch 1 with the first instructor.
  slotSpecs.slice(0, 14).forEach((sp) => { sp.b = branches[0]; sp.i = instructors[0]; });
  const seen = new Set();
  for (const sp of slotSpecs) {
    const key = `${sp.b.id}|${sp.d}|${sp.t[0]}|${sp.i.id}`;
    if (seen.has(key)) continue; seen.add(key);
    const r = await call('seed:timetable-slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: sp.b.id, instructorId: sp.i.id, weekday: sp.d, startTime: sp.t[0], endTime: sp.t[1], title: `BJJ ${sp.t[0]}`, styles, capacity: size === 'small' ? 20 : 40 });
    if (r.status >= 300) throw new Error('slot ' + JSON.stringify(r.body));
    slots.push(r.body.id);
  }

  // One-off classes for the round 1–3 probes (same shapes as round 1).
  const mkClass = async (title, cap, startOff, endOff, extra = {}) => {
    const r = await call('seed:class', 'POST', `/schools/${school.id}/classes`, tOwner, { branchId: branches[0].id, instructorId: instructors[0].id, title, styles, startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + endOff).toISOString(), membershipInclusion: true, ...(cap === null ? {} : { capacity: cap }), ...extra });
    if (r.status >= 300) throw new Error('class ' + JSON.stringify(r.body));
    return r.body;
  };
  const nNow = size === 'small' ? 3 : 12;
  const nowClasses = [];
  for (let k = 0; k < nNow; k++) nowClasses.push(await mkClass(`Now ${k}`, 40, -10 * 60e3, 50 * 60e3));
  const tiny = [await mkClass('Tiny A', 10, -5 * 60e3, 55 * 60e3), await mkClass('Tiny B', 3, -5 * 60e3, 55 * 60e3)];
  const open = await mkClass('Open mat (no cap)', null, -10 * 60e3, 80 * 60e3);
  const closed = await mkClass('Booking closed', 40, 2 * 3600e3, 3 * 3600e3, { bookingEndAt: new Date(now - 60e3).toISOString() });
  const endedNew = await mkClass('Ended yesterday', 40, 22 * 3600e3, 23 * 3600e3);
  const ended = await db.class.update({ where: { id: endedNew.id }, data: { startDate: new Date(now - 26 * 3600e3), endDate: new Date(now - 25 * 3600e3) } });
  const future = await mkClass('Next week', 40, 7 * 86400e3, 7 * 86400e3 + 3600e3);

  // Plans. The app stores every amount in hundredths whatever the currency
  // (apps/school-portal/src/lib/money.ts), so JPY and KWD prices are too.
  const m = 100;
  const plan = (type, title, major, extra = {}) => ({ id: randomUUID(), schoolId: school.id, type, title, price: Math.round(major * country.priceScale * m), currency: country.currency, ...extra });
  const plans = [
    plan('SUBSCRIPTION', 'Unlimited', 180), plan('CLASS_PACK', '5-class pack', 90, { classesIncluded: 5 }),
    plan('CLASS_PACK', '10-class pack', 160, { classesIncluded: 10, expiryDurationDays: 90 }), plan('WEEKLY_PASS', 'Week pass', 40, { expiryDurationDays: 7 }),
    plan('FRIEND_PASS', 'Friend pass', 0, { classesIncluded: 1 }), plan('TRIAL_MEMBERSHIP', 'Free trial', 0, { expiryDurationDays: 14 }),
  ];
  await db.membershipPlan.createMany({ data: plans });
  const [sub, pack, pack10, week, , trial] = plans;

  // Students.
  const nStudents = ri(sMin, sMax);
  const students = await mkUsers(nStudents, country);
  await db.roleGrant.createMany({ data: students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id, branchId: branches[i % nBranches].id })) });
  const kinds = []; const memberships = [];
  students.forEach((u, i) => {
    const r = rand();
    // Round 1 kinds first (sub/pack/expired/none), then the round 4 extras.
    const kind = r < 0.6 ? 'sub' : r < 0.75 ? 'pack' : r < 0.8 ? 'expired' : r < 0.86 ? 'pack10' : r < 0.89 ? 'week' : r < 0.92 ? 'trial' : r < 0.95 ? 'lapsed' : 'none';
    kinds.push(kind);
    const base = { id: randomUUID(), studentId: u.id, schoolId: school.id };
    if (kind === 'sub') memberships.push({ ...base, membershipPlanId: sub.id, frequency: 'RECURRING' });
    if (kind === 'pack') memberships.push({ ...base, membershipPlanId: pack.id, frequency: 'ONE_TIME', classesRemaining: 5 });
    if (kind === 'expired') memberships.push({ ...base, membershipPlanId: sub.id, frequency: 'RECURRING', expiryDate: new Date(now - 3600e3) });
    if (kind === 'pack10') memberships.push({ ...base, membershipPlanId: pack10.id, frequency: 'ONE_TIME', classesRemaining: ri(0, 10), expiryDate: new Date(now + ri(1, 90) * 86400e3) });
    if (kind === 'week') memberships.push({ ...base, membershipPlanId: week.id, frequency: 'ONE_TIME', expiryDate: new Date(now + ri(1, 7) * 86400e3) });
    if (kind === 'trial') memberships.push({ ...base, membershipPlanId: trial.id, frequency: 'ONE_TIME', expiryDate: new Date(now + ri(1, 14) * 86400e3) });
    if (kind === 'lapsed') memberships.push({ ...base, membershipPlanId: sub.id, frequency: 'RECURRING', status: 'EXPIRED', expiryDate: new Date(now - ri(10, 200) * 86400e3) });
  });
  for (let i = 0; i < memberships.length; i += 2000) await db.membership.createMany({ data: memberships.slice(i, i + 2000) });

  // Guardians: a quarter of the children, in families of 1–4.
  const kids = students.filter((u) => now - u.dateOfBirth.getTime() < 16 * YEAR);
  const linked = kids.filter(() => rand() < 0.25);
  const families = [];
  for (let i = 0; i < linked.length;) { const n = ri(1, 4); families.push(linked.slice(i, i + n)); i += n; }
  const gUsers = families.length ? await mkUsers(families.length, country, { adult: true }) : [];
  if (gUsers.length) {
    await db.roleGrant.createMany({ data: gUsers.map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: school.id })) });
    await db.guardianLink.createMany({ data: families.flatMap((f, i) => f.map((k) => ({ id: randomUUID(), guardianId: gUsers[i].id, studentId: k.id }))) });
  }

  const entry = {
    id: school.id, n: s, size, country: country.cc, currency: country.currency, lang: country.lang, tz, franchiseId: fr?.id ?? null,
    branches: branches.map((b) => b.id), owner: { id: owner.id, tok: tOwner }, coOwner: size !== 'small' ? { id: coOwner.id, tok: tok(coOwner, [grant('SCHOOL_OWNER_MANAGER', school.id)]) } : null,
    instructor: { id: instructors[0].id, tok: tInstr }, instructors: instructors.map((u) => u.id), staff: { id: bstaff[0].id, tok: tStaff },
    disciplineId: discipline.id, extraDisciplines: extraDisc, classType, slots, nowClasses: nowClasses.map((c) => c.id), tiny: tiny.map((c) => c.id), open: open.id, closed: closed.id, ended: ended.id, future: future.id,
    plans: Object.fromEntries(plans.map((p) => [p.title, p.id])),
    students: students.map((u, i) => ({ id: u.id, tok: tok(u, [grant('STUDENT', school.id, branches[i % nBranches].id)]), kind: kinds[i], branch: branches[i % nBranches].id })),
    guardians: gUsers.map((g, i) => ({ id: g.id, tok: tok(g, [grant('GUARDIAN', school.id)]), kids: families[i].map((k) => k.id) })),
  };
  if (fr) fr.schools.push(school.id);
  done++;
  if (done % 10 === 0 || size === 'xlarge') process.stdout.write(`school ${done}/${N_SCHOOLS} (${size} ${country.cc}, ${nStudents} students, ${slots.length} slots) ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  return entry;
}

cast.schools = (await pool(Array.from({ length: N_SCHOOLS }, (_, i) => i), CONCURRENCY, async (s) => {
  try { return await seedSchool(s); } catch (e) { console.error(`school ${s} failed:`, e.message); return null; }
})).filter(Boolean);
const tSeed = (Date.now() - t0) / 1000;

// A Guardian with children at two Schools: link 200 children of one School to Guardians of another.
for (let k = 0; k + 1 < cast.schools.length && k < 400; k += 2) {
  const a = cast.schools[k], b = cast.schools[k + 1];
  const g = a.guardians[0]; const child = b.students.find((st) => st.kind === 'sub');
  if (!g || !child) continue;
  await db.roleGrant.create({ data: { id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: b.id } });
  await db.guardianLink.create({ data: { id: randomUUID(), guardianId: g.id, studentId: child.id } });
  cast.guardians.push({ guardian: g.id, schools: [a.id, b.id], child: child.id });
}
// Instructors teaching at two Schools: 100 pairs.
for (let k = 0; k + 3 < cast.schools.length && k < 400; k += 4) {
  const a = cast.schools[k], b = cast.schools[k + 3];
  const u = a.instructors[a.instructors.length - 1];
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u, role: 'INSTRUCTOR', schoolId: b.id, branchId: b.branches[0] } });
  await db.instructor.create({ data: { id: randomUUID(), userId: u, schoolId: b.id, branchId: b.branches[0] } }).catch(() => {});
}
// Franchise owners.
for (const fr of franchises) {
  const [u] = await mkUsers(1, COUNTRIES.find((c) => c.cc === fr.countries[0]) || COUNTRIES[0], { adult: true });
  await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'FRANCHISE_OWNER', franchiseId: fr.id } });
  cast.franchises.push({ id: fr.id, countries: fr.countries, schools: fr.schools, owner: { id: u.id, tok: tok(u, [{ role: 'FRANCHISE_OWNER', franchiseId: fr.id, schoolId: null, branchId: null }]) } });
}

// Generate 4 weeks of timetable Classes through the real job.
const q = new Queue('class-occurrence-generation', { connection: { url: process.env.REDIS_URL } });
const tg = Date.now();
// Creating a slot already builds its first weeks of Classes, so count them all.
const before = 0;
await q.add('run', {});
const want = cast.schools.reduce((a, s) => a + s.slots.length, 0) * 4;
let last = -1, stable = 0, genCount = 0;
for (;;) {
  genCount = await db.class.count({ where: { timetableSlotId: { not: null } } }) - before;
  if (genCount === last) stable++; else stable = 0;
  last = genCount;
  if (genCount >= want * 0.97 || stable >= 5 || Date.now() - tg > 1800e3) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const tGen = (Date.now() - tg) / 1000;
await q.close();

fs.writeFileSync(new URL('./cast.json', import.meta.url), JSON.stringify(cast));
const total = cast.schools.reduce((a, s) => a + s.students.length, 0);
const sizeRow = (await db.$queryRawUnsafe(`select pg_database_size(current_database())::bigint as b`))[0];
const summary = {
  schools: cast.schools.length, failed: N_SCHOOLS - cast.schools.length, students: total,
  guardians: cast.schools.reduce((a, s) => a + s.guardians.length, 0), franchises: cast.franchises.length,
  bySize: Object.fromEntries(['small', 'medium', 'large', 'xlarge'].map((k) => [k, cast.schools.filter((s) => s.size === k).length])),
  countries: new Set(cast.schools.map((s) => s.country)).size, currencies: new Set(cast.schools.map((s) => s.currency)).size,
  slots: cast.schools.reduce((a, s) => a + s.slots.length, 0), generatedClasses: genCount, expectedClasses: want, generatorSeconds: tGen,
  seedSeconds: tSeed, dbBytes: Number(sizeRow.b), dbMBper1000Students: +(Number(sizeRow.b) / 1048576 / (total / 1000)).toFixed(2),
};
console.log(summary);
fs.writeFileSync(new URL('./world-result.json', import.meta.url), JSON.stringify({ summary, latency: report() }, null, 1));
await db.$disconnect();
