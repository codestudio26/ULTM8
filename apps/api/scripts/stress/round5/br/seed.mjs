// Round 5, BR persona (Rafael): seeds a large Brazilian Jiu-Jitsu academy
// (São Paulo + Manaus + Rio Branches, BRL, pt-BR, week starts Sunday) inside a
// Franchise that also has a Portuguese School (EUR, Europe/Lisbon).
// Users, grants, Guardian links, memberships go straight into the DB (sign-up
// needs SMS), the rest through the API. Writes cast-br.json next to this file.
//   CAST=../empty-cast.json node seed.mjs
import fs from 'fs';
import { db, call, grant, randomUUID, tokenRca } from '../../round4/common.mjs';

const now = Date.now();
const DAY = 86400e3; const YEAR = 365.25 * DAY;
let rnd = 5555; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const RUN = Date.now().toString(36);
let seq = 0;
const FIRST = ['João', 'Maria da Glória', 'Ênio', 'Conceição', 'Thiago', 'Luíza', 'Ana Clara', 'Pedro Henrique', 'Gabriel', 'Isabela', 'Lucas', 'Júlia', 'Matheus', 'Letícia', 'Caio', 'Iara', 'Tainá', 'Raí', 'Kauã', 'Maria Eduarda'];
const LAST = ['Conceição dos Santos', 'da Silva', 'Araújo', 'Gonçalves', 'Magalhães', 'Gracie', 'Machado', 'Ferreira', 'de Oliveira', 'Nascimento', 'Sá', "D'Ávila", 'Brandão-Lopes', 'Pereira'];
const phone = () => '+55119' + String(61000000 + seq).padStart(8, '0');

async function mkUsers(specs) {
  const rows = specs.map((s) => {
    const k = seq++;
    return {
      id: randomUUID(), email: s.email ?? `r5-br-${RUN}-${k}@stress.test`, phone: s.phone === undefined ? phone() : s.phone,
      firstName: s.first ?? pick(FIRST), surname: s.last ?? pick(LAST), passcodeHash: 'x',
      dateOfBirth: s.dob ?? new Date(now - (20 + rand() * 30) * YEAR), phoneVerifiedAt: new Date(), language: 'pt-BR', currency: s.currency ?? 'BRL',
      gender: s.gender ?? (rand() < 0.4 ? 'FEMALE' : 'MALE'),
    };
  });
  for (let i = 0; i < rows.length; i += 2000) await db.user.createMany({ data: rows.slice(i, i + 2000) });
  return rows;
}
const age = (y, plusDays = 0) => new Date(now - y * YEAR + plusDays * DAY);

// ---------- Franchise ----------
const franchise = await db.franchise.create({ data: { id: randomUUID(), name: `R5 BR Franquia Norte ${RUN}`, addressCountry: 'BR' } });

async function mkSchool({ name, tz, currency, cc, weekStartsOn, branches }) {
  const school = await db.school.create({ data: {
    id: randomUUID(), name, timezone: tz, ranksToggle: true, defaultCurrency: currency, defaultLanguage: 'pt-BR', addressCountry: cc,
    addressLine1: 'Rua Augusta 1500', addressCity: cc === 'BR' ? 'São Paulo' : 'Lisboa', addressPostalCode: cc === 'BR' ? '01304-001' : '1100-001',
    franchiseId: franchise.id, waitlistClaimWindowMinutes: 60, classCancellationPolicy: 'AUTO_CREDIT', cancellationPolicyChosenAt: new Date(),
    taxCountry: cc, weekStartsOn,
  } });
  const brs = [];
  for (const b of branches) brs.push(await db.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: b.name, timezone: b.tz, addressCountry: cc, addressLine1: b.addr, addressCity: b.city, addressPostalCode: b.cep } }));
  return { school, branches: brs };
}

const SP = await mkSchool({ name: `R5 BR Academia Conceição Jiu-Jitsu ${RUN}`, tz: 'America/Sao_Paulo', currency: 'BRL', cc: 'BR', weekStartsOn: 'SUNDAY', branches: [
  { name: 'São Paulo — Pinheiros', tz: null, addr: 'Rua dos Pinheiros 870', city: 'São Paulo', cep: '05422-001' },
  { name: 'Manaus — Adrianópolis', tz: 'America/Manaus', addr: 'Av. Djalma Batista 1200', city: 'Manaus', cep: '69050-010' },
  { name: 'Rio — Copacabana', tz: 'America/Sao_Paulo', addr: 'Rua Barata Ribeiro 200', city: 'Rio de Janeiro', cep: '22011-000' },
] });
const PT = await mkSchool({ name: `R5 BR Academia Lisboa ${RUN}`, tz: 'Europe/Lisbon', currency: 'EUR', cc: 'PT', weekStartsOn: 'MONDAY', branches: [
  { name: 'Lisboa — Alfama', tz: null, addr: 'Rua de São Miguel 10', city: 'Lisboa', cep: '1100-544' },
] });
const S = SP.school.id; const [bSP, bMAO, bRIO] = SP.branches.map((b) => b.id);

// ---------- Staff ----------
const [rafael, coOwner, frOwner, ptOwner, instrSP, instrMAO, instrRIO, staffSP, staffMAO, staffRIO, ptInstr, guardianCoach] = await mkUsers([
  { first: 'Rafael', last: 'Conceição dos Santos', email: `r5-br-${RUN}-rafael@stress.test` },
  { first: 'Maria da Glória', last: 'Machado' }, { first: 'Ênio', last: 'Gracie' }, { first: 'Joaquim', last: 'Sá', currency: 'EUR' },
  { first: 'Thiago', last: 'Braga' }, { first: 'Raí', last: 'Baniwa' }, { first: 'Kauã', last: 'Nogueira' },
  { first: 'Letícia', last: 'Farias' }, { first: 'Iara', last: 'Tikuna' }, { first: 'Caio', last: 'Ribeiro' }, { first: 'Inês', last: 'Gonçalves', currency: 'EUR' },
  { first: 'Tainá', last: 'Pereira' }, // Instructor in SP who is also a Guardian
]);
await db.roleGrant.createMany({ data: [
  { id: randomUUID(), userId: rafael.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: S, isMainOwner: true },
  { id: randomUUID(), userId: rafael.id, role: 'STUDENT', schoolId: S, branchId: bSP }, // owner also trains
  { id: randomUUID(), userId: coOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: S },
  { id: randomUUID(), userId: frOwner.id, role: 'FRANCHISE_OWNER', franchiseId: franchise.id },
  { id: randomUUID(), userId: ptOwner.id, role: 'SCHOOL_OWNER_MANAGER', schoolId: PT.school.id, isMainOwner: true },
  { id: randomUUID(), userId: instrSP.id, role: 'INSTRUCTOR', schoolId: S, branchId: bSP },
  { id: randomUUID(), userId: instrMAO.id, role: 'INSTRUCTOR', schoolId: S, branchId: bMAO },
  { id: randomUUID(), userId: instrRIO.id, role: 'INSTRUCTOR', schoolId: S, branchId: bRIO },
  { id: randomUUID(), userId: guardianCoach.id, role: 'INSTRUCTOR', schoolId: S, branchId: bSP },
  { id: randomUUID(), userId: staffSP.id, role: 'BRANCH_STAFF', schoolId: S, branchId: bSP },
  { id: randomUUID(), userId: staffMAO.id, role: 'BRANCH_STAFF', schoolId: S, branchId: bMAO },
  { id: randomUUID(), userId: staffRIO.id, role: 'BRANCH_STAFF', schoolId: S, branchId: bRIO },
  { id: randomUUID(), userId: ptInstr.id, role: 'INSTRUCTOR', schoolId: PT.school.id, branchId: PT.branches[0].id },
] });
await db.instructor.createMany({ data: [[instrSP, bSP], [instrMAO, bMAO], [instrRIO, bRIO], [guardianCoach, bSP]].map(([u, b]) => ({ id: randomUUID(), userId: u.id, schoolId: S, branchId: b })).concat([{ id: randomUUID(), userId: ptInstr.id, schoolId: PT.school.id, branchId: PT.branches[0].id }]) });
const T = {
  owner: tokenRca(rafael, [grant('SCHOOL_OWNER_MANAGER', S)]),
  co: tokenRca(coOwner, [grant('SCHOOL_OWNER_MANAGER', S)]),
  fr: tokenRca(frOwner, [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }]),
  pt: tokenRca(ptOwner, [grant('SCHOOL_OWNER_MANAGER', PT.school.id)]),
  instrSP: tokenRca(instrSP, [grant('INSTRUCTOR', S, bSP)]), instrMAO: tokenRca(instrMAO, [grant('INSTRUCTOR', S, bMAO)]),
  staffSP: tokenRca(staffSP, [grant('BRANCH_STAFF', S, bSP)]), staffMAO: tokenRca(staffMAO, [grant('BRANCH_STAFF', S, bMAO)]), staffRIO: tokenRca(staffRIO, [grant('BRANCH_STAFF', S, bRIO)]),
};
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

// ---------- Disciplines, plans, payment account ----------
const bjj = must(await call('seed', 'POST', `/schools/${S}/disciplines/from-template`, T.owner, { templateId: 'ibjjf', name: 'Jiu-Jitsu' }), 'template');
const kidsBjj = must(await call('seed', 'POST', `/schools/${S}/disciplines/from-template`, T.owner, { templateId: 'ibjjf_kids_yellow', name: 'Jiu-Jitsu Kids' }), 'template kids');
const muay = must(await call('seed', 'POST', `/schools/${S}/disciplines`, T.owner, { name: 'Muay Thai' }), 'muay');
const judo = must(await call('seed', 'POST', `/schools/${S}/disciplines`, T.owner, { name: 'Judô' }), 'judo');
const ptBjj = must(await call('seed', 'POST', `/schools/${PT.school.id}/disciplines/from-template`, T.pt, { templateId: 'ibjjf', name: 'Jiu-Jitsu' }), 'pt template');
const ct = async (id) => ((await db.discipline.findUnique({ where: { id } })).classTypesOffered || [])[0] ?? null;
const styles = { bjj: [{ disciplineId: bjj.id, classType: await ct(bjj.id) }], kids: [{ disciplineId: kidsBjj.id, classType: await ct(kidsBjj.id) }], muay: [{ disciplineId: muay.id, classType: null }], judo: [{ disciplineId: judo.id, classType: null }], pt: [{ disciplineId: ptBjj.id, classType: await ct(ptBjj.id) }] };

must(await call('seed', 'POST', `/schools/${S}/payment-accounts`, T.owner, { provider: 'CASH', accountTitle: 'Recepção', country: 'BR' }), 'cash acct');
must(await call('seed', 'POST', `/schools/${PT.school.id}/payment-accounts`, T.pt, { provider: 'CASH', accountTitle: 'Receção', country: 'PT' }), 'pt cash acct');
const mkPlan = async (tok, school, body) => must(await call('seed:plan', 'POST', `/schools/${school}/membership-plans`, tok, body), 'plan ' + body.title);
const plans = {
  mensal: await mkPlan(T.owner, S, { type: 'SUBSCRIPTION', title: 'Mensalidade Ilimitada', price: 34990, currency: 'BRL' }),
  pack10: await mkPlan(T.owner, S, { type: 'CLASS_PACK', title: 'Pacote 10 aulas', price: 45000, currency: 'BRL', classesIncluded: 10, expiryDurationDays: 90 }),
  pack5: await mkPlan(T.owner, S, { type: 'CLASS_PACK', title: 'Pacote 5 aulas (Kids)', price: 19990, currency: 'BRL', classesIncluded: 5 }),
  semana: await mkPlan(T.owner, S, { type: 'WEEKLY_PASS', title: 'Passe Semanal Turista', price: 15000, currency: 'BRL', expiryDurationDays: 7 }),
  trial: await mkPlan(T.owner, S, { type: 'TRIAL_MEMBERSHIP', title: 'Aula Experimental', price: 0, currency: 'BRL', expiryDurationDays: 7 }),
  friend: await mkPlan(T.owner, S, { type: 'FRIEND_PASS', title: 'Passe Amigo', price: 0, currency: 'BRL', classesIncluded: 1 }),
  ptPack: await mkPlan(T.pt, PT.school.id, { type: 'CLASS_PACK', title: 'Pack 10 aulas', price: 9000, currency: 'EUR', classesIncluded: 10 }),
};

// ---------- Timetable: kids-heavy, three Branches ----------
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const slotDefs = [];
for (const [b, ins] of [[bSP, instrSP], [bMAO, instrMAO], [bRIO, instrRIO]]) {
  for (const d of DAYS.slice(1, 6)) {
    slotDefs.push({ branchId: b, instructorId: ins.id, weekday: d, startTime: '06:30', endTime: '07:30', title: 'Jiu-Jitsu Madrugada', styles: styles.bjj, capacity: 30 });
    slotDefs.push({ branchId: b, instructorId: ins.id, weekday: d, startTime: '17:00', endTime: '18:00', title: 'Kids 4-7 anos', styles: styles.kids, capacity: 20 });
    slotDefs.push({ branchId: b, instructorId: ins.id, weekday: d, startTime: '18:00', endTime: '19:00', title: 'Kids 8-13 anos', styles: styles.kids, capacity: 25 });
    slotDefs.push({ branchId: b, instructorId: ins.id, weekday: d, startTime: '19:30', endTime: '21:00', title: 'Jiu-Jitsu Adulto', styles: styles.bjj, capacity: 40 });
  }
  slotDefs.push({ branchId: b, instructorId: ins.id, weekday: 'SATURDAY', startTime: '10:00', endTime: '11:30', title: 'Open Mat Sábado', styles: styles.bjj, capacity: 60 });
}
slotDefs.push({ branchId: bSP, instructorId: instrSP.id, weekday: 'FRIDAY', startTime: '23:00', endTime: '00:30', title: 'Treino da Meia-Noite', styles: styles.bjj, capacity: 30 });
slotDefs.push({ branchId: bSP, instructorId: guardianCoach.id, weekday: 'SUNDAY', startTime: '09:00', endTime: '10:00', title: 'Muay Thai Domingo', styles: styles.muay, capacity: 20 });
const slots = [];
for (const sd of slotDefs) {
  const r = await call('seed:slot', 'POST', `/schools/${S}/timetable`, T.owner, sd);
  if (r.status >= 300) { console.log('slot failed', sd.title, sd.weekday, sd.startTime, r.status, JSON.stringify(r.body)); continue; }
  slots.push({ id: r.body.id, ...sd });
}
const ptSlot = must(await call('seed:slot', 'POST', `/schools/${PT.school.id}/timetable`, T.pt, { branchId: PT.branches[0].id, instructorId: ptInstr.id, weekday: 'MONDAY', startTime: '19:00', endTime: '20:30', title: 'BJJ Adultos', styles: styles.pt, capacity: 30 }), 'pt slot');

// ---------- Students ----------
const N = Number(process.env.N_STUDENTS || 1400);
const specs = [];
for (let i = 0; i < N; i++) {
  const r = rand();
  const dob = r < 0.08 ? age(2 + rand() * 2.9) : r < 0.35 ? age(5 + rand() * 7) : r < 0.45 ? age(13 + rand() * 4.5) : r < 0.95 ? age(18.3 + rand() * 40) : age(60 + rand() * 20);
  specs.push({ dob });
}
// Special people (index noted in cast).
const special = {
  turning18: { first: 'Maria Eduarda', last: 'Conceição dos Santos', dob: age(18, 3) },
  turned18: { first: 'Kauã', last: 'Brandão-Lopes', dob: age(18, -1) },
  senior95: { first: 'Sebastião', last: 'Nascimento', dob: age(95, -10) },
  senior72: { first: 'Dona Glória', last: 'Machado', dob: age(72) },
  leap: { first: 'Bissexto', last: 'Ferreira', dob: new Date(Date.UTC(2012, 1, 29)) },
  leapAdult: { first: 'Ana', last: 'Fevereiro', dob: new Date(Date.UTC(1996, 1, 29)) },
  longName: { first: 'Pedro de Alcântara Francisco Antônio João Carlos Xavier de Paula Miguel Rafael Joaquim José Gonzaga', last: 'Pascoal Cipriano Serafim de Bragança e Bourbon' },
  mononym: { first: 'Ronaldinho', last: '' },
  emoji: { first: 'Luíza 🥋', last: 'Sá 🇧🇷' },
  combining: { first: 'João', last: 'Conceição' }, // NFD
  apostrophe: { first: "Ana D'Ávila", last: "O'Neill-Gonçalves" },
  injection: { first: "Robert'); DROP TABLE users;--", last: '<script>alert(1)</script>' },
  disability: { first: 'Gabriel', last: 'Autista Araújo' },
  arabic: { first: 'محمد', last: 'Haddad' },
};
const specialKeys = Object.keys(special);
for (const k of specialKeys) specs.push(special[k]);
const students = await mkUsers(specs);
const sp = Object.fromEntries(specialKeys.map((k, i) => [k, students[N + i]]));
const branchOf = (i) => (i % 10 < 6 ? bSP : i % 10 < 8 ? bMAO : bRIO);
await db.roleGrant.createMany({ data: students.map((u, i) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: S, branchId: branchOf(i) })) });

// Memberships
const ms = []; const kinds = [];
students.forEach((u, i) => {
  const r = rand(); const base = { id: randomUUID(), studentId: u.id, schoolId: S };
  const kind = i >= N ? 'none' : r < 0.55 ? 'sub' : r < 0.7 ? 'pack10' : r < 0.78 ? 'pack5' : r < 0.82 ? 'semana' : r < 0.85 ? 'trial' : r < 0.9 ? 'lapsed' : 'none';
  kinds.push(kind);
  if (kind === 'sub') ms.push({ ...base, membershipPlanId: plans.mensal.id, frequency: 'RECURRING' });
  if (kind === 'pack10') ms.push({ ...base, membershipPlanId: plans.pack10.id, frequency: 'ONE_TIME', classesRemaining: 1 + Math.floor(rand() * 10), expiryDate: new Date(now + (10 + rand() * 80) * DAY) });
  if (kind === 'pack5') ms.push({ ...base, membershipPlanId: plans.pack5.id, frequency: 'ONE_TIME', classesRemaining: 5 });
  if (kind === 'semana') ms.push({ ...base, membershipPlanId: plans.semana.id, frequency: 'ONE_TIME', expiryDate: new Date(now + 5 * DAY) });
  if (kind === 'trial') ms.push({ ...base, membershipPlanId: plans.trial.id, frequency: 'ONE_TIME', expiryDate: new Date(now + 5 * DAY) });
  if (kind === 'lapsed') ms.push({ ...base, membershipPlanId: plans.mensal.id, frequency: 'RECURRING', status: 'EXPIRED', expiryDate: new Date(now - 40 * DAY) });
});
await db.membership.createMany({ data: ms });

// Guardians: families of 1–4 kids (<18), plus special families.
const kids = students.slice(0, N).filter((u) => now - u.dateOfBirth.getTime() < 18 * YEAR);
const linked = kids.filter(() => rand() < 0.6);
const families = [];
for (let i = 0; i < linked.length;) { const n = 1 + Math.floor(rand() * 4); families.push(linked.slice(i, i + n)); i += n; }
const gUsers = await mkUsers(families.map(() => ({ dob: age(30 + rand() * 20) })));
// Special: a 4-kid family with two Guardians (divorced), the guardian-coach parent, turning-18 and leap kids linked.
const big = families.find((f) => f.length === 4);
const [secondParent] = await mkUsers([{ first: 'Cláudia', last: 'Conceição' }]);
await db.roleGrant.createMany({ data: [...gUsers, secondParent, guardianCoach].map((g) => ({ id: randomUUID(), userId: g.id, role: 'GUARDIAN', schoolId: S })) });
const links = families.flatMap((f, i) => f.map((k) => ({ id: randomUUID(), guardianId: gUsers[i].id, studentId: k.id })));
links.push(...big.map((k) => ({ id: randomUUID(), guardianId: secondParent.id, studentId: k.id })));
const coachKids = [sp.leap, sp.turning18];
links.push(...coachKids.map((k) => ({ id: randomUUID(), guardianId: guardianCoach.id, studentId: k.id })));
await db.guardianLink.createMany({ data: links });
// One Guardian in the big family also trains (adult student grant at SP).
const bigG = gUsers[families.indexOf(big)];
await db.roleGrant.create({ data: { id: randomUUID(), userId: bigG.id, role: 'STUDENT', schoolId: S, branchId: bSP } });

// PT students (EUR)
const ptStudents = await mkUsers(Array.from({ length: 40 }, () => ({ currency: 'EUR' })));
await db.roleGrant.createMany({ data: ptStudents.map((u) => ({ id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: PT.school.id, branchId: PT.branches[0].id })) });

const stTok = (u, i) => tokenRca(u, [grant('STUDENT', S, branchOf(i))]);
const cast = {
  run: RUN, franchiseId: franchise.id, S, PT: PT.school.id, ptBranch: PT.branches[0].id, branches: { SP: bSP, MAO: bMAO, RIO: bRIO },
  users: { rafael: rafael.id, coOwner: coOwner.id, frOwner: frOwner.id, ptOwner: ptOwner.id, instrSP: instrSP.id, instrMAO: instrMAO.id, instrRIO: instrRIO.id, staffSP: staffSP.id, staffMAO: staffMAO.id, staffRIO: staffRIO.id, guardianCoach: guardianCoach.id, secondParent: secondParent.id, bigG: bigG.id },
  tok: T, plans: Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, p.id])), styles, slots, ptSlot: ptSlot.id,
  disciplines: { bjj: bjj.id, kids: kidsBjj.id, muay: muay.id, judo: judo.id },
  students: students.map((u, i) => ({ id: u.id, email: u.email, kind: kinds[i], branch: branchOf(i), dob: u.dateOfBirth, tok: stTok(u, i) })),
  special: Object.fromEntries(specialKeys.map((k) => [k, sp[k].id])),
  families: families.map((f, i) => ({ g: gUsers[i].id, gEmail: gUsers[i].email, kids: f.map((k) => k.id), tok: tokenRca(gUsers[i], [grant('GUARDIAN', S)]) })),
  big: { kids: big.map((k) => k.id), g1: bigG.id, g2: secondParent.id, g2tok: tokenRca(secondParent, [grant('GUARDIAN', S)]), g1tok: tokenRca(bigG, [grant('GUARDIAN', S), grant('STUDENT', S, bSP)]) },
  coachGuardianTok: tokenRca(guardianCoach, [grant('INSTRUCTOR', S, bSP), grant('GUARDIAN', S)]),
  pt: { students: ptStudents.map((u) => ({ id: u.id, tok: tokenRca(u, [grant('STUDENT', PT.school.id, PT.branches[0].id)]) })) },
};
fs.writeFileSync(new URL('./cast-br.json', import.meta.url), JSON.stringify(cast));
console.log({ run: RUN, students: students.length, kids: kids.length, guardians: gUsers.length + 2, families: families.length, slots: slots.length, slotDefs: slotDefs.length, pt: ptStudents.length });
await db.$disconnect();
