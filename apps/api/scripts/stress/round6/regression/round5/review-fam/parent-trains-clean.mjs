// FAM review: clean reproduction of "a parent who also trains can't book their child"
// (GB-1, AE-1, NG-3, AU-1, BR-1, GB-9). Fresh School, NO GUARDIAN role grant
// anywhere (Decision 427 item 2: the product never creates one). Each parent has
// only the grants the product itself would give them; every parent links to the
// same child via GuardianLink, exactly as POST /guardians/me/minors writes it.
import { db, call, grant, tokenRca, randomUUID } from '../../round4/common.mjs';
const tag = Date.now();
const mkUser = (label, dob = '1985-03-03') => db.user.create({ data: { id: randomUUID(), email: `r5-fam-${label}-${tag}@stress.test`, firstName: 'Fam', surname: label, passcodeHash: 'x', dateOfBirth: new Date(dob), phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'GBP' } });
const school = await db.school.create({ data: { id: randomUUID(), name: `R5 FAM Review Dojo ${tag}`, timezone: 'Europe/London', defaultCurrency: 'GBP', defaultLanguage: 'en-GB', addressCountry: 'GB', classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(), taxCountry: 'GB' } });
const S = school.id;
const b1 = await db.branch.create({ data: { id: randomUUID(), schoolId: S, name: 'Main', addressCountry: 'GB' } });
const b2 = await db.branch.create({ data: { id: randomUUID(), schoolId: S, name: 'Second', addressCountry: 'GB' } });
const owner = await mkUser('owner'); const coach = await mkUser('coach');
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: owner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: S, isMainOwner: true },
  { id: randomUUID(), userId: coach.id, role: 'INSTRUCTOR', schoolId: S, branchId: b1.id },
] });
const instr = await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: S, branchId: b1.id } });
const tOwner = tokenRca(owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: S, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000, currency: 'GBP' } });
// Child: a Guardian-managed minor enrolled at Main (STUDENT grant + home Branch + live membership).
const kid = await mkUser('kid', '2016-05-05');
await db.roleGrant.create({ data: { id: randomUUID(), userId: kid.id, role: 'STUDENT', schoolId: S, branchId: b1.id } });
await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: S, studentId: kid.id, branchId: b1.id } });
await db.membership.create({ data: { id: randomUUID(), studentId: kid.id, schoolId: S, membershipPlanId: plan.id, frequency: 'RECURRING' } });
const mkClass = async (title, cap, day) => {
  const st = new Date(Date.now() + day * 86400e3);
  const r = await call('fam:class', 'POST', `/schools/${S}/classes`, tOwner, { branchId: b1.id, instructorId: coach.id, title, startDate: st.toISOString(), endDate: new Date(+st + 3600e3).toISOString(), capacity: cap, membershipInclusion: true, activities: ['Judo'] });
  if (r.status >= 300) throw new Error(JSON.stringify(r.body));
  return r.body.id;
};
// Parents. No GUARDIAN grant for anyone.
const parents = [
  ['plain', []],
  ['trains-same-branch', [['STUDENT', b1.id]]],
  ['trains-other-branch', [['STUDENT', b2.id]]],
  ['coach-parent', [['INSTRUCTOR', b1.id]]],
];
const out = {};
for (const [label, roles] of parents) {
  const p = await mkUser(label);
  for (const [role, br] of roles) {
    await db.roleGrant.create({ data: { id: randomUUID(), userId: p.id, role, schoolId: S, branchId: br } });
    if (role === 'STUDENT') await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: S, studentId: p.id, branchId: br } });
    if (role === 'INSTRUCTOR') await db.instructor.create({ data: { id: randomUUID(), userId: p.id, schoolId: S, branchId: br } });
  }
  await db.guardianLink.create({ data: { id: randomUUID(), guardianId: p.id, studentId: kid.id } });
  const t = tokenRca(p, roles.map(([r, br]) => grant(r, S, br)));
  // Round 6 adaptation (Decision 430 item 9, FAM-9): the parent gives BASELINE consent in the app first.
  const consent = await call('fam:consent', 'POST', `/guardians/me/minors/${kid.id}/consent`, t, { tier: 'BASELINE', policyVersion: '1.0-placeholder' });
  if (consent.status >= 300 && consent.status !== 409) throw new Error('consent ' + JSON.stringify(consent.body));
  const c1 = await mkClass(`Book ${label}`, 20, 2);
  const book = await call('fam', 'POST', `/classes/${c1}/book`, t, { studentId: kid.id });
  const cancel = book.status === 201 ? await call('fam', 'PATCH', `/bookings/${book.body.id}/cancel`, t, { studentId: kid.id } /* round 6: the app sends the child's id */) : { status: '-' };
  // Waitlist: full class (capacity 1, filled by the owner's staff booking of the coach-free filler).
  const c2 = await mkClass(`Full ${label}`, 1, 3);
  const filler = await mkUser(`filler-${label}`);
  await db.roleGrant.create({ data: { id: randomUUID(), userId: filler.id, role: 'STUDENT', schoolId: S, branchId: b1.id } });
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: S, studentId: filler.id, branchId: b1.id } });
  await db.membership.create({ data: { id: randomUUID(), studentId: filler.id, schoolId: S, membershipPlanId: plan.id, frequency: 'RECURRING' } });
  const f = await call('fam', 'POST', `/classes/${c2}/book`, tokenRca(filler, [grant('STUDENT', S, b1.id)]), {});
  const wl = await call('fam', 'POST', `/classes/${c2}/waitlist`, t, { studentId: kid.id });
  const del = await call('fam', 'POST', `/guardians/me/minors/${kid.id}/booking-delegation`, t, {});
  const km = await call('fam', 'POST', `/guardians/me/minors/${kid.id}/kid-mode-token`, t, {});
  const c3 = await mkClass(`Kid ${label}`, 20, 4);
  const kbook = await call('fam', 'POST', `/classes/${c3}/book`, km.body?.accessToken, { studentId: kid.id });
  const kb = kbook.status === 201 ? await db.booking.findUnique({ where: { id: kbook.body.id } }) : null;
  const bk = book.status === 201 ? await db.booking.findUnique({ where: { id: book.body.id } }) : null;
  out[label] = { book: `${book.status} ${book.status === 201 ? '' : JSON.stringify(book.body).slice(0, 110)}`, cancel: cancel.status, fillerBook: f.status, waitlist: `${wl.status} ${wl.status < 300 ? '' : JSON.stringify(wl.body).slice(0, 110)}`, kidMode: `${del.status}/${km.status}/${kbook.status} ${kbook.status === 201 ? '' : JSON.stringify(kbook.body).slice(0, 110)}` };
  console.log(label.padEnd(20), JSON.stringify(out[label]));
}
const g = await db.roleGrant.count({ where: { schoolId: S, role: 'GUARDIAN' } });
console.log('GUARDIAN grants at this School:', g, ' school', S);
await db.$disconnect();
