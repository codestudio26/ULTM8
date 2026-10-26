// Phase 1: 30 schools, 300-500 students each, ladders, timetable, classes, memberships.
// Writes the cast (ids + tokens) to cast.json for the later phases.
import fs from 'fs';
import { db, call, pool, token, grant, randomUUID, report, Queue } from './lib.mjs';

const N_SCHOOLS = Number(process.env.N_SCHOOLS || 30);
const TZ = ['Australia/Sydney', 'Europe/London', 'America/Sao_Paulo', 'America/New_York', null];
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
let rnd = 42; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
let phoneN = Number(process.env.PHONE_BASE || 1000000000); const phone = () => '+1555' + String(phoneN++);
const now = Date.now();

async function mkUsers(n, label, school) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), email: `st-${label}-${i}-${randomUUID().slice(0, 8)}@stress.test`, phone: phone(), firstName: `${label}${i}`, surname: 'Stress', passcodeHash: 'x', dateOfBirth: new Date(rand() < 0.25 ? '2014-05-01' : '1995-05-01'), phoneVerifiedAt: new Date() }));
  for (let i = 0; i < rows.length; i += 1000) await db.user.createMany({ data: rows.slice(i, i + 1000) });
  return rows;
}

const cast = { schools: [] };
const t0 = Date.now();
for (let s = 0; s < N_SCHOOLS; s++) {
  const tz = TZ[s % TZ.length];
  const school = await db.school.create({ data: { id: randomUUID(), name: `Stress Academy ${s + 1}`, timezone: tz, ranksToggle: true, waitlistClaimWindowMinutes: 60 } });
  const nBranches = 1 + (s % 3);
  const branches = [];
  for (let b = 0; b < nBranches; b++) branches.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Branch ${b + 1}` } }));
  const [owner, instructor, staff] = await mkUsers(3, `s${s}staff`);
  await db.roleGrant.createMany({ data: [
    { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id },
    { id: randomUUID(), userId: instructor.id, role: 'INSTRUCTOR', schoolId: school.id, branchId: branches[0].id },
    { id: randomUUID(), userId: staff.id, role: 'BRANCH_STAFF', schoolId: school.id, branchId: branches[0].id },
  ] });
  await db.instructor.create({ data: { id: randomUUID(), userId: instructor.id, schoolId: school.id, branchId: branches[0].id } });
  const tOwner = token(owner, [grant('SCHOOL_OWNER_MANAGER', school.id)]);
  const tInstr = token(instructor, [grant('INSTRUCTOR', school.id, branches[0].id)]);
  const tStaff = token(staff, [grant('BRANCH_STAFF', school.id, branches[0].id)]);

  // Style from the IBJJF template, through the API.
  const tpl = ['ibjjf', 'ibjjf_kids_red', 'ibjjf_kids_yellow'][s % 3];
  const disc = await call('seed:style-template', 'POST', `/schools/${school.id}/disciplines/from-template`, tOwner, { templateId: tpl, name: 'BJJ' });
  if (disc.status >= 300) throw new Error('template ' + JSON.stringify(disc.body));
  const discipline = await db.discipline.findUnique({ where: { id: disc.body.id } });
  const classType = (discipline.classTypesOffered || [])[0] ?? null;
  const styles = [{ disciplineId: discipline.id, classType }];

  // Timetable: 2 slots a day, every day, branch 1; generator builds 4 weeks of Classes.
  const slots = [];
  for (const d of DAYS) for (const [st, en] of [['07:00', '08:00'], ['18:30', '20:00']]) {
    const r = await call('seed:timetable-slot', 'POST', `/schools/${school.id}/timetable`, tOwner, { branchId: branches[0].id, instructorId: instructor.id, weekday: d, startTime: st, endTime: en, title: `BJJ ${st}`, styles, capacity: 40 });
    if (r.status >= 300) throw new Error('slot ' + JSON.stringify(r.body));
    slots.push(r.body.id);
  }

  // One-off classes running now (check-in window open): 12 big, 2 tiny (capacity races), 1 unlimited.
  const nowClasses = [];
  const mkClass = async (title, cap, startOff, endOff, extra = {}) => {
    const r = await call('seed:class', 'POST', `/schools/${school.id}/classes`, tOwner, { branchId: branches[0].id, instructorId: instructor.id, title, styles, startDate: new Date(now + startOff).toISOString(), endDate: new Date(now + endOff).toISOString(), ...(cap === null ? {} : { capacity: cap }), ...extra });
    if (r.status >= 300) throw new Error('class ' + JSON.stringify(r.body));
    return r.body;
  };
  for (let k = 0; k < 12; k++) nowClasses.push(await mkClass(`Now ${k}`, 40, -10 * 60e3, 50 * 60e3));
  const tiny = [await mkClass('Tiny A', 10, -5 * 60e3, 55 * 60e3), await mkClass('Tiny B', 3, -5 * 60e3, 55 * 60e3)];
  const open = await mkClass('Open mat (no cap)', null, -10 * 60e3, 80 * 60e3);
  // Probes for the gate audit (phase 3): booking closed, already ended, archived later.
  const closed = await mkClass('Booking closed', 40, 2 * 3600e3, 3 * 3600e3, { bookingEndAt: new Date(now - 60e3).toISOString() });
  const ended = await mkClass('Ended yesterday', 40, -26 * 3600e3, -25 * 3600e3);
  const future = await mkClass('Next week', 40, 7 * 86400e3, 7 * 86400e3 + 3600e3);

  // Membership plans (DB: purchase needs Stripe) and students.
  const nStudents = 300 + Math.floor(rand() * 201);
  const students = await mkUsers(nStudents, `s${s}`);
  await db.roleGrant.createMany({ data: students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: school.id, branchId: branches[i % nBranches].id })) });
  const sub = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 18000 } });
  const pack = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-class pack', price: 9000, classesIncluded: 5 } });
  const kinds = [];
  const memberships = [];
  students.forEach((u, i) => {
    const r = rand();
    const kind = r < 0.7 ? 'sub' : r < 0.9 ? 'pack' : r < 0.95 ? 'expired' : 'none';
    kinds.push(kind);
    if (kind === 'sub') memberships.push({ id: randomUUID(), studentId: u.id, membershipPlanId: sub.id, schoolId: school.id, frequency: 'RECURRING' });
    if (kind === 'pack') memberships.push({ id: randomUUID(), studentId: u.id, membershipPlanId: pack.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 5 });
    // ACTIVE but its expiryDate passed an hour ago and the sweep hasn't run yet.
    if (kind === 'expired') memberships.push({ id: randomUUID(), studentId: u.id, membershipPlanId: sub.id, schoolId: school.id, frequency: 'RECURRING', expiryDate: new Date(now - 3600e3) });
  });
  for (let i = 0; i < memberships.length; i += 1000) await db.membership.createMany({ data: memberships.slice(i, i + 1000) });

  cast.schools.push({
    id: school.id, tz, branches: branches.map((b) => b.id), owner: { id: owner.id, tok: tOwner }, instructor: { id: instructor.id, tok: tInstr }, staff: { id: staff.id, tok: tStaff },
    disciplineId: discipline.id, classType, slots, nowClasses: nowClasses.map((c) => c.id), tiny: tiny.map((c) => c.id), open: open.id, closed: closed.id, ended: ended.id, future: future.id,
    students: students.map((u, i) => ({ id: u.id, tok: token(u, [grant('STUDENT', school.id, branches[i % nBranches].id)]), kind: kinds[i], branch: branches[i % nBranches].id })),
  });
  process.stdout.write(`school ${s + 1}/${N_SCHOOLS}: ${nStudents} students (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

// Generate 4 weeks of timetable Classes through the real job.
const q = new Queue('class-occurrence-generation', { connection: { url: process.env.REDIS_URL } });
const tg = Date.now();
await q.add('run', {});
const want = cast.schools.length * 14 * 4;
for (;;) {
  const n = await db.class.count({ where: { timetableSlotId: { not: null } } });
  if (n >= want - cast.schools.length * 2 || Date.now() - tg > 600e3) { console.log(`generated ${n} timetable Classes in ${((Date.now() - tg) / 1000).toFixed(1)}s (expected about ${want})`); break; }
  await new Promise((r) => setTimeout(r, 1000));
}
await q.close();

fs.writeFileSync(new URL('./cast.json', import.meta.url), JSON.stringify(cast));
const total = cast.schools.reduce((a, s) => a + s.students.length, 0);
console.log(`seeded ${cast.schools.length} schools, ${total} students in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
report();
await db.$disconnect();
