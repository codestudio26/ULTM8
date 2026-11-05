// FAM review probes on the clean School made by parent-trains-clean.mjs (SCHOOL env).
// GB-2 (child becomes Guardian), GB-3/IN-1 (add-child validation), NG-4 (retry duplicates),
// GB-4 (child buys a plan), GB-6/BR-2 (parent keeps control at 18).
import { db, call, grant, tokenRca, randomUUID } from '../../round4/common.mjs';
const S = process.env.SCHOOL; const tag = Date.now();
const b1 = await db.branch.findFirst({ where: { schoolId: S, name: 'Main' } });
const mkUser = (label, dob) => db.user.create({ data: { id: randomUUID(), email: `r5-fam-${label}-${tag}@stress.test`, firstName: 'Fam', surname: label, passcodeHash: 'x', dateOfBirth: dob ? new Date(dob) : null, phoneVerifiedAt: new Date(), language: 'en-GB', currency: 'GBP' } });
const enrol = async (u) => { await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: S, branchId: b1.id } }); await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: S, studentId: u.id, branchId: b1.id } }); };
const r = {};
// GB-2: a self-registered 10-year-old (no Guardian) adds a "child".
const liam = await mkUser('liam10', '2016-01-10'); await enrol(liam);
const tLiam = tokenRca(liam, [grant('STUDENT', S, b1.id)]);
const m = await call('fam', 'POST', '/guardians/me/minors', tLiam, { firstName: 'Baby', surname: 'Brother', dateOfBirth: '2020-01-01' });
r.GB2_child_adds_minor = m.status;
// GB-4: the same 10-year-old buys a Class Pack (CASH account, no waiver needed).
await db.paymentAccount.upsert({ where: { schoolId: S }, create: { id: randomUUID(), schoolId: S, provider: 'CASH', accountTitle: 'Desk', country: 'GB' }, update: {} });
const pack = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: S, type: 'CLASS_PACK', title: '5 pack', price: 3000, currency: 'GBP', classesIncluded: 5 } });
const buy = await call('fam', 'POST', `/membership-plans/${pack.id}/purchase`, tLiam, {});
r.GB4_child_buys = `${buy.status} ${JSON.stringify(buy.body).slice(0, 140)}`;
// GB-3 / IN-1: validation on POST /guardians/me/minors by a real adult parent.
const parent = await mkUser('parentv', '1984-04-04');
const tP = tokenRca(parent, []);
for (const [k, body] of Object.entries({
  dob2099: { firstName: 'A', surname: 'B', dateOfBirth: '2099-01-01' },
  dob1960adult: { firstName: 'Grown', surname: 'Up', dateOfBirth: '1960-01-01' },
  feb30: { firstName: 'C', surname: 'D', dateOfBirth: '2017-02-30' },
  blankSurname: { firstName: 'E', surname: '   ', dateOfBirth: '2017-02-01' },
  len150: { firstName: 'x'.repeat(150), surname: 'y'.repeat(150), dateOfBirth: '2017-02-01' },
})) { const x = await call('fam', 'POST', '/guardians/me/minors', tP, body); r[`GB3_${k}`] = `${x.status}${x.status === 201 ? ' dob=' + (await db.user.findUnique({ where: { id: x.body.studentId } }))?.dateOfBirth?.toISOString().slice(0, 10) : ''}`; }
// NG-4: 8 identical requests at once, then one retry.
const same = { firstName: 'Abubakar', surname: 'Ibrahim', dateOfBirth: '2018-06-12' };
const par = await Promise.all(Array.from({ length: 8 }, () => call('fam', 'POST', '/guardians/me/minors', tP, same)));
await call('fam', 'POST', '/guardians/me/minors', tP, same);
const links = await db.guardianLink.findMany({ where: { guardianId: parent.id }, include: { student: true } }).catch(() => null);
const dupes = links ? links.filter((l) => l.student?.firstName === 'Abubakar').length : (await db.$queryRawUnsafe(`select count(*)::int c from "GuardianLink" gl join "User" u on u.id=gl."studentId" where gl."guardianId"=$1 and u."firstName"='Abubakar'`, parent.id))[0].c;
r.NG4_parallel_codes = par.map((p) => p.status).join(','); r.NG4_children_created = dupes;
// GB-6 / BR-2: a teen who turned 18 yesterday, still linked to the parent.
const d = new Date(); const dob18 = `${d.getUTCFullYear() - 18}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate() - 1).padStart(2, '0')}`;
const teen = await mkUser('teen18', dob18); await enrol(teen);
await db.membership.create({ data: { id: randomUUID(), studentId: teen.id, schoolId: S, membershipPlanId: (await db.membershipPlan.findFirst({ where: { schoolId: S, type: 'SUBSCRIPTION' } })).id, frequency: 'RECURRING' } });
await db.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: teen.id } });
const coach = await db.roleGrant.findFirst({ where: { schoolId: S, role: 'INSTRUCTOR', branchId: b1.id } });
const owner = await db.roleGrant.findFirst({ where: { schoolId: S, role: 'SCHOOL_OWNER_MANAGER' }, include: { user: true } });
const st = new Date(Date.now() + 5 * 86400e3);
const c = await call('fam', 'POST', `/schools/${S}/classes`, tokenRca(owner.user, [grant('SCHOOL_OWNER_MANAGER', S)]), { branchId: b1.id, instructorId: coach.userId, title: 'Adults', startDate: st.toISOString(), endDate: new Date(+st + 3600e3).toISOString(), capacity: 20, activities: ['Judo'] });
const bk = await call('fam', 'POST', `/classes/${c.body.id}/book`, tP, { studentId: teen.id });
const del = await call('fam', 'POST', `/guardians/me/minors/${teen.id}/booking-delegation`, tP, {});
const km = await call('fam', 'POST', `/guardians/me/minors/${teen.id}/kid-mode-token`, tP, {});
const cons = await call('fam', 'POST', `/guardians/me/minors/${teen.id}/consent`, tP, { tier: 'BASELINE', policyVersion: 'v1' });
r.GB6_teen_dob = dob18; r.GB6_parent_books_adult = bk.status; r.GB6_kidmode = `${del.status}/${km.status}`; r.GB6_consent_for_adult = cons.status;
console.log(JSON.stringify(r, null, 1));
await db.$disconnect();
