// Round 7 S (from round 6 P's world.mjs): builds one School, each with two Branches and the people the access
// tests need, all made through the product's own API flows (no GUARDIAN
// grants for parents, no Branch on STUDENT grants: round 5's harness lesson).
//
//   School A: UK (GB), no payment account yet (the Connect Stripe tests make it).
//   School B: Brazil (BR), bank transfer (Pix) account, "Let Branch Staff
//             record payments" on.
// Writes out/world.json. Run: node world.mjs
import { call, must, signUp, signIn, runJob, db, saveWorld, at, H, D } from './lib.mjs';

const CFG = {
  A: { country: 'GB', tz: 'Europe/London', cur: 'GBP', lang: 'en-GB', addr: { line1: '1 High St', city: 'London', postalCode: 'E1 6AN', country: 'GB' } },
  B: { country: 'BR', tz: 'America/Sao_Paulo', cur: 'BRL', lang: 'pt-BR', addr: { line1: 'Rua Augusta, 10', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' } },
};

async function grant(owner, userId, role, schoolId, branchId) {
  return must(`grant ${role}`, 'POST', `/users/${userId}/role-grants`, owner.tok, { role, schoolId, ...(branchId ? { branchId } : {}) });
}

async function buildSchool(key, cfgKey = key) {
  const c0 = CFG[cfgKey];
  const c = c0;
  const P = {};
  const mk = (role, first, extra = {}) => signUp({ first, last: `${role}${key}`, country: c.country, language: c.lang, currency: c.cur, ...extra });
  P.owner = await mk('Owner', 'Olive', { dob: '1980-01-01' });
  const school = await must('school', 'POST', '/schools', P.owner.tok, { name: `R7S School ${key} ${Date.now()}`, timezone: c.tz, defaultCurrency: c.cur, defaultLanguage: c.lang, postalAddress: c.addr, ranksToggle: true, acceptAgreement: true });
  await signIn(P.owner);
  const sid = school.id;
  const O = () => P.owner.tok;
  // noHome and the parent join before the School has Branches, so they have
  // no home Branch (the product's own way to get one; joining a School with
  // Branches asks for one).
  const member = async (k, first, branchId) => {
    P[k] = await mk(k, first, { dob: '1990-05-05' });
    await must(`join ${k}`, 'POST', `/schools/${sid}/join`, P[k].tok, branchId ? { branchId } : {});
    await signIn(P[k]);
  };
  await member('noHome', 'Nia', null);
  await member('parent', 'Pam', null);
  const b1 = await must('b1', 'POST', `/schools/${sid}/branches`, O(), { name: `${key} North`, postalAddress: c.addr });
  const b2 = await must('b2', 'POST', `/schools/${sid}/branches`, O(), { name: `${key} South`, postalAddress: c.addr });
  const style = await must('style', 'POST', `/schools/${sid}/disciplines/from-template`, O(), { templateId: 'ibjjf', name: 'BJJ' });
  const disc = await db.discipline.findUnique({ where: { id: style.id } });
  const styles = [{ disciplineId: style.id, classType: (disc.classTypesOffered || [])[0] ?? null }];

  // Owner also coaches at b1 (needed as a class instructor).
  await grant(P.owner, P.owner.id, 'INSTRUCTOR', sid, b1.id);
  await signIn(P.owner);
  await grant(P.owner, P.owner.id, 'INSTRUCTOR', sid, b2.id);
  await signIn(P.owner);
  await must('owner instructor', 'POST', `/schools/${sid}/instructors`, O(), { userId: P.owner.id, branchId: b1.id, specializationStyleIds: [style.id] });

  // Staff and coaches.
  P.coowner = await mk('Coowner', 'Cora');
  await grant(P.owner, P.coowner.id, 'SCHOOL_OWNER_MANAGER', sid);
  P.staff1 = await mk('StaffNorth', 'Sam');
  await grant(P.owner, P.staff1.id, 'BRANCH_STAFF', sid, b1.id);
  P.staff2 = await mk('StaffSouth', 'Sue');
  await grant(P.owner, P.staff2.id, 'BRANCH_STAFF', sid, b2.id);
  P.staffStripe = await mk('StaffStripe', 'Stan');
  await grant(P.owner, P.staffStripe.id, 'BRANCH_STAFF', sid, b1.id);
  P.coach = await mk('Coach', 'Carl');
  await grant(P.owner, P.coach.id, 'INSTRUCTOR', sid, b1.id);
  await signIn(P.coach);
  await must('coach profile', 'POST', `/schools/${sid}/instructors`, O(), { userId: P.coach.id, branchId: b1.id, specializationStyleIds: [style.id] });
  for (const k of ['coowner', 'staff1', 'staff2', 'staffStripe', 'coach']) await signIn(P[k]);
  // staffStripe gets "Can connect Stripe"; everyone else keeps the defaults.
  const list = await must('staff list', 'GET', `/schools/${sid}/staff`, O());
  const row = (list.items ?? list).find((x) => x.userId === P.staffStripe.id);
  await must('connectStripe on', 'PUT', `/schools/${sid}/staff/${P.staffStripe.id}/access`, O(), { ...(row?.access ?? {}), connectStripe: true });

  // Waiver, plans, classes.
  const waiver = await must('waiver', 'POST', `/schools/${sid}/waivers`, O(), { title: `Waiver ${key}`, body: 'Training carries a risk of injury.' });
  const pack = await must('pack', 'POST', `/schools/${sid}/membership-plans`, O(), { currency: c.cur, type: 'CLASS_PACK', title: `Pack ${key}`, price: 5000, classesIncluded: 10, expiryDurationDays: 90 });
  const mkClass = (title, branchId, startOff, endOff, extra = {}) => must(`class ${title}`, 'POST', `/schools/${sid}/classes`, O(), {
    branchId, instructorId: P.owner.id, title, styles, startDate: at(startOff), endDate: at(endOff), membershipInclusion: true, ...extra,
  });
  const classes = {
    now1: await mkClass('Now North', b1.id, -10 * 60e3, 50 * 60e3, { capacity: 20 }),
    tomorrow1: await mkClass('Tomorrow North', b1.id, D, D + H, { capacity: 20 }),
    small1: await mkClass('Small North', b1.id, D + 2 * H, D + 3 * H, { capacity: 1 }),
    now2: await mkClass('Now South', b2.id, -10 * 60e3, 50 * 60e3, { capacity: 20 }),
    past1: await mkClass('Past North', b1.id, 2 * D, 2 * D + H, { capacity: 20 }),
  };
  // A class 3 days ago (for the past-attendance import): the API refuses to
  // create a class that has ended, so it is made ahead and moved back in the
  // database (a harness shortcut; the import only needs a class that started).
  await db.class.update({ where: { id: classes.past1.id }, data: { startDate: new Date(Date.now() - 3 * D), endDate: new Date(Date.now() - 3 * D + H) } });

  if (key === 'B') {
    await must('pix account', 'POST', `/schools/${sid}/payment-accounts`, O(), { provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' });
    await must('record payments on', 'PATCH', `/schools/${sid}`, O(), { branchStaffCanRecordPayments: true });
  }

  // Members (self sign-up + join). adult1: home b1; adult2: home b2;
  // noHome: joined with no Branch; parent + child (home b1); unsigned: never signs.
  await member('adult1', 'Ada', b1.id);
  await member('adult2', 'Abe', b2.id);
  await member('unsigned', 'Una', b1.id);
  const child = await must('add child', 'POST', '/guardians/me/minors', P.parent.tok, { firstName: 'Kit', surname: `Child${key}`, dateOfBirth: '2016-05-20', consentPolicyVersion: '1.0-placeholder' });
  const childId = child.id ?? child.studentId;
  await must('child joins', 'POST', `/schools/${sid}/join`, P.parent.tok, { branchId: b1.id, studentId: childId });
  // Signed waivers for adult1, adult2, noHome, parent (self) and the child.
  for (const k of ['adult1', 'adult2', 'noHome', 'parent']) {
    await must(`sign ${k}`, 'POST', `/waivers/${waiver.id}/sign`, P[k].tok, { signerFullName: `${P[k].first} ${P[k].last}`, signatureText: `${P[k].first} ${P[k].last}` });
  }
  await must('sign child', 'POST', `/waivers/${waiver.id}/sign`, P.parent.tok, { studentId: childId, signerFullName: `${P.parent.first} ${P.parent.last}`, signatureText: `${P.parent.first} ${P.parent.last}` });
  // An unsigned child too (for the parent / Kid Mode waiver paths).
  const child2 = await must('add child2', 'POST', '/guardians/me/minors', P.parent.tok, { firstName: 'Kip', surname: `Child${key}`, dateOfBirth: '2015-03-03', consentPolicyVersion: '1.0-placeholder' });
  const child2Id = child2.id ?? child2.studentId;
  await must('child2 joins', 'POST', `/schools/${sid}/join`, P.parent.tok, { branchId: b1.id, studentId: child2Id });

  return { key, id: sid, b1: b1.id, b2: b2.id, styleId: style.id, styles, waiverId: waiver.id, packId: pack.id, classes: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.id])), childId, child2Id, people: P };
}

export { buildSchool, grant };
