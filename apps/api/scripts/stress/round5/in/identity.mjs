// Mononyms, shared phone/email, Guardian-made minors, Unicode normalisation in search.
import fs from 'fs';
import { db, call, grant, tokenRca, randomUUID } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId; const B = C.branches[0];
const tOwner = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const R = Date.now().toString().slice(-6);
const out = {};
const sh = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 220)}`;
const add = (k, body) => call('add', 'POST', `/schools/${S}/students/add-manually`, tOwner, { email: `r5-in-${R}-${k}@stress.test`, dateOfBirth: '1995-05-05', branchId: B, ...body });

// I1 mononym adult via Add manually
out.I1_surnameEmpty = sh(await add('m1', { firstName: 'Venkataraghavan', surname: '' }));
out.I1_surnameSpace = sh(await add('m2', { firstName: 'Venkataraghavan', surname: ' ' }));
out.I1_surnameMissing = sh(await add('m3', { firstName: 'Venkataraghavan' }));
const dot = await add('m4', { firstName: 'Venkataraghavan', surname: '.' });
out.I1_surnameDot = sh(dot);
// I1b mononym child via Add child manually
out.I1b_childNoSurname = sh(await call('add-child', 'POST', `/schools/${S}/students/add-child-manually`, tOwner, { child: { firstName: 'Ilakkiya', surname: '', dateOfBirth: '2016-03-03' }, guardian: { firstName: 'Suriya', surname: '', email: `r5-in-${R}-g1@stress.test` }, branchId: B }));
// I1c staff clears a placeholder surname on the profile
const anyAdult = C.students.find((s) => s.first === 'Venkataraghavan');
out.I1c_patchSurnameEmpty = sh(await call('patch', 'PATCH', `/schools/${S}/students/${anyAdult.id}/profile`, tOwner, { surname: '' }));

// I2 shared phone: two adults in one family, one phone
const sib = C.students.find((s) => s.phone && s.dob < '2000-01-01');
out.I2_sharedPhone = sh(await add('p1', { firstName: 'Lakshmi', surname: 'Iyer', phone: sib.phone }));
// I3 shared email: an adult whose email is already a family member's account
out.I3_sharedEmail = sh(await call('add', 'POST', `/schools/${S}/students/add-manually`, tOwner, { email: sib.email.toUpperCase(), firstName: 'Ravi', surname: 'Iyer', dateOfBirth: '1990-01-01', branchId: B }));
// I3b sibling with a +tag on the family email
out.I3b_plusTag = sh(await call('add', 'POST', `/schools/${S}/students/add-manually`, tOwner, { email: sib.email.replace('@', '+ravi@'), firstName: 'Ravi', surname: 'Iyer', dateOfBirth: '1990-01-01', branchId: B }));

// I4 Guardian creates a "minor" in the Student app (POST /guardians/me/minors)
const g = C.guardians[1];
const tG = tokenRca(g, [grant('GUARDIAN', S)]);
const mk = (dto) => call('minor', 'POST', '/guardians/me/minors', tG, dto);
out.I4_adultAsMinor = sh(await mk({ firstName: 'Grown', surname: 'Up', dateOfBirth: '1960-01-01' }));
out.I4_futureBirth = sh(await mk({ firstName: 'Not', surname: 'Born', dateOfBirth: '2090-01-01' }));
out.I4_blankSurname = sh(await mk({ firstName: 'Kavya', surname: '   ', dateOfBirth: '2018-06-06' }));
out.I4_150chars = sh(await mk({ firstName: 'A'.repeat(150), surname: 'B'.repeat(150), dateOfBirth: '2018-06-06' }));
out.I4_feb29_2023 = sh(await mk({ firstName: 'Leap', surname: 'Wrong', dateOfBirth: '2023-02-29' }));

// I5 precomposed vs decomposed nukta in stored names (Devanagari typed on different keyboards)
const pre = 'ज़ोया'; // ज़ोया, precomposed ZA (Windows/legacy IMEs, many copy-pastes)
const dec = 'ज़ोया'; // ज़ोया, ja + nukta (NFC form)
const u = { id: randomUUID(), email: `r5-in-${R}-nukta@stress.test`, phone: null, firstName: pre, surname: 'ख़ान', passcodeHash: 'x', dateOfBirth: new Date('2000-01-01'), language: 'en', currency: 'INR' };
await db.user.create({ data: u });
await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: S, branchId: B } });
const s1 = await call('search', 'GET', `/schools/${S}/students?search=${encodeURIComponent(pre)}`, tOwner);
const s2 = await call('search', 'GET', `/schools/${S}/students?search=${encodeURIComponent(dec)}`, tOwner);
out.I5 = { storedPrecomposed_searchPrecomposed: (s1.body.items || []).filter((i) => i.id === u.id).length, storedPrecomposed_searchNFC: (s2.body.items || []).filter((i) => i.id === u.id).length, nfcOfStored: [...pre.normalize('NFC')].map((c) => c.codePointAt(0).toString(16)) };
// Does the API normalise names on write? Add manually with the precomposed form
const w = await add('nukta2', { firstName: pre, surname: 'Khan' });
const back = w.status < 300 ? await db.user.findFirst({ where: { email: `r5-in-${R}-nukta2@stress.test` }, select: { firstName: true } }) : null;
out.I5_writeNormalised = { status: w.status, stored: back && [...back.firstName].map((c) => c.codePointAt(0).toString(16)) };
// Tamil: search typed with a ZWJ/ZWNJ (common from some keyboards)
const t1 = await call('search', 'GET', `/schools/${S}/students?search=${encodeURIComponent('கார்‌த்திக்')}`, tOwner);
out.I5_tamilZWNJ = t1.body?.items?.length;
// Latin accents (Decision 418 folds accents for waiver search; roster?)
const acc = { id: randomUUID(), email: `r5-in-${R}-acc@stress.test`, phone: null, firstName: 'Sébastien', surname: 'Pereira', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') };
await db.user.create({ data: acc });
await db.roleGrant.create({ data: { id: randomUUID(), userId: acc.id, role: 'STUDENT', schoolId: S, branchId: B } });
const a1 = await call('search', 'GET', `/schools/${S}/students?search=Sebastien`, tOwner);
out.I5_accentFold = (a1.body.items || []).filter((i) => i.id === acc.id).length;

// I6 Find me on the front-desk tablet with a mononym / initials, and the 95-year-old
const sess = await call('fd', 'POST', `/schools/${S}/front-desk/sessions`, tOwner, { branchId: B });
const kt = sess.body?.sessionToken;
const fm = (fullName, dateOfBirth) => call('find-me', 'POST', '/front-desk/kiosk/find-me', kt, { fullName, dateOfBirth });
const mono = C.students.find((s) => s.first === 'Venkataraghavan' && s.last === '.');
const ini = C.students.find((s) => s.first === 'K. R. Venkataraghavan');
out.I6 = {
  session: sess.status,
  monoAsTyped: sh(await fm('Venkataraghavan', mono.dob)),
  monoWithDot: sh(await fm('Venkataraghavan .', mono.dob)),
  initialsFull: sh(await fm('K. R. Venkataraghavan Subramanian', ini.dob)),
  initialsNoDots: sh(await fm('KR Venkataraghavan Subramanian', ini.dob)),
  initialsSurnameFirst: sh(await fm('Subramanian K. R. Venkataraghavan', ini.dob)),
};
fs.writeFileSync(new URL('./identity-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await db.$disconnect();
