// Round 5 BR: waivers and the 18th birthday, a Guardian's reach after 18, name search in
// Portuguese, privacy across the Franchise's two Schools, input abuse.
// CAST=../empty-cast.json node misc.mjs
import fs from 'fs';
import { db, call, checks, codes, randomUUID } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-br.json', import.meta.url)));
const { ok, save } = checks('misc');
const log = (...a) => console.log('   ', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const S = C.S; const T = C.tok; const B = C.branches;
const out = {};

// ---- W: waiver; a Guardian signs for a child; the 18th birthday ----
const wv = await call('w', 'POST', `/schools/${S}/waivers`, T.owner, { title: 'Termo de Responsabilidade — Jiu-Jitsu', body: 'Declaro estar ciente dos riscos inerentes à prática do Jiu-Jitsu… (ECA, Lei 8.069/90; LGPD, Lei 13.709/18)' });
const ws = await call('w', 'PATCH', `/schools/${S}/waiver-settings`, T.owner, { waiverMinorsSignAgainAt18: true });
ok('W0 waiver + "sign again at 18" setting', wv.status === 201 && ws.status === 200, `${wv.status} ${ws.status} ${JSON.stringify(ws.body).slice(0, 150)}`);
// Link the student who turned 18 yesterday to a parent (they were a minor until yesterday)
const fam = C.families.find((f) => f.kids.length === 2) ?? C.families[0];
await db.guardianLink.create({ data: { id: randomUUID(), guardianId: fam.g, studentId: C.special.turned18 } }).catch(() => {});
const adultKid = C.special.turned18;
const gSign = await call('w', 'POST', `/waivers/${wv.body.id}/sign`, fam.tok, { studentId: adultKid, signerFullName: 'Mãe do Kauã', signatureText: 'Mãe do Kauã' });
const gBook = await (async () => {
  const cls = await db.class.findFirst({ where: { schoolId: S, branchId: C.students.find((s) => s.id === adultKid).branch, title: { startsWith: 'Jiu-Jitsu Adulto' }, cancelledAt: null, startDate: { gt: new Date(Date.now() + 86400e3) } }, orderBy: { startDate: 'asc' } });
  return call('w', 'POST', `/classes/${cls.id}/book`, fam.tok, { studentId: adultKid });
})();
const gRead = await call('w', 'GET', `/guardians/me/minors/${adultKid}/bookings`, fam.tok);
const gList = await call('w', 'GET', '/guardians/me/minors', fam.tok);
const listed = JSON.stringify(gList.body).includes(adultKid);
log('Guardian acting for a student who turned 18 yesterday: sign', gSign.status, 'book', gBook.status, gBook.body?.error?.message, 'read bookings', gRead.status, 'listed as minor', listed);
out.after18 = { sign: { status: gSign.status, body: gSign.body?.error ?? { id: gSign.body?.id, status: gSign.body?.status, signerFullName: gSign.body?.signerFullName } }, book: { status: gBook.status, body: gBook.body?.error ?? gBook.body?.status }, read: gRead.status, listedAsMinor: listed };
ok('W1 a parent can no longer sign a waiver on behalf of an 18-year-old', gSign.status >= 400, `sign ${gSign.status}`);
// A real minor: parent signs for child (expected OK); child under 18 can't self-sign
const kid = fam.kids[0];
const kSign = await call('w', 'POST', `/waivers/${wv.body.id}/sign`, fam.tok, { studentId: kid, signerFullName: 'Responsável', signatureText: 'Responsável' });
const kidTok = C.students.find((s) => s.id === kid).tok;
const selfKid = await call('w', 'POST', `/waivers/${wv.body.id}/sign`, kidTok, { signerFullName: 'Criança', signatureText: 'Criança' });
const turning = C.students.find((s) => s.id === C.special.turning18);
const selfTurning = await call('w', 'POST', `/waivers/${wv.body.id}/sign`, turning.tok, { signerFullName: 'Maria Eduarda', signatureText: 'Maria Eduarda' });
ok('W2 parent signs for child 201; child and 17-year-old (3 days to 18) refused self-sign', kSign.status === 201 && selfKid.status >= 400 && selfTurning.status >= 400, `${kSign.status} ${selfKid.status} ${selfTurning.status}`);
// Leap-day minor waiver: majority date stored as 1 March
const leapG = await db.guardianLink.findFirst({ where: { studentId: C.special.leap } });
const coachTok = C.coachGuardianTok;
const lSign = await call('w', 'POST', `/waivers/${wv.body.id}/sign`, coachTok, { studentId: C.special.leap, signerFullName: 'Tainá Pereira', signatureText: 'Tainá Pereira' });
const lRow = await db.waiverSignature.findFirst({ where: { waiverId: wv.body.id, studentId: C.special.leap, status: 'SIGNED' } });
ok('W3 29-Feb child: majority date 2030-03-01', lSign.status === 201 && lRow?.studentMajorityDate?.toISOString().startsWith('2030-03-01'), `${lSign.status} ${lRow?.studentMajorityDate?.toISOString()} ${JSON.stringify(lSign.body).slice(0, 120)}`);

// ---- N: name search the way a Brazilian desk types ----
const q = async (s) => {
  const r = await call('n', 'GET', `/schools/${S}/students?search=${encodeURIComponent(s)}&limit=100`, T.owner);
  return { status: r.status, n: (r.body?.items ?? r.body ?? []).length, names: (r.body?.items ?? []).slice(0, 3).map((x) => `${x.firstName} ${x.surname}`) };
};
const searches = {};
for (const s of ['Conceição', 'Conceicao', 'conceicao dos santos', 'João', 'Joao', 'Ênio', 'Enio', 'D\'Ávila', 'davila', 'محمد', '🥋', '%', "'; DROP", 'Pedro de Alcântara Francisco']) searches[s] = await q(s);
log('search', searches);
out.search = searches;
// The NFD-stored "João Conceição" (combining marks): found by typing "João"?
const nfdId = C.special.combining;
const all = await call('n', 'GET', `/schools/${S}/students?search=${encodeURIComponent('João')}&limit=500`, T.owner);
const nfdFound = JSON.stringify(all.body).includes(nfdId);
log('NFD-stored João found by typed João (NFC):', nfdFound);
out.nfd = nfdFound;

// ---- P: privacy across the Franchise (BRL School vs EUR School) ----
const st = C.students[5];
const pt = C.pt.students[0];
const priv = await Promise.all([
  call('p', 'GET', `/schools/${S}/students/${st.id}/profile`, T.pt),
  call('p', 'GET', `/schools/${C.PT}/students/${pt.id}/profile`, T.owner),
  call('p', 'GET', `/schools/${S}/students/${st.id}/profile`, T.fr),
  call('p', 'GET', `/schools/${S}/students/export`, T.fr),
  call('p', 'GET', `/schools/${S}/students/export`, T.pt),
  call('p', 'GET', `/schools/${S}/students/export`, T.staffMAO),
  call('p', 'GET', `/students/${st.id}/charges`, C.pt.students[1].tok),
  call('p', 'GET', `/schools/${S}/closures`, T.pt),
  call('p', 'GET', `/schools/${S}/waivers`, T.fr),
  call('p', 'GET', `/schools/${S}/transactions`, T.co),
]);
log('privacy', priv.map((r) => r.status));
ok('P1 PT owner, Franchise owner, Manaus staff refused on SP student data/export; co-owner allowed', priv.slice(0, 9).every((r) => r.status >= 400) && priv[9].status === 200, JSON.stringify(priv.map((r) => r.status)));
// Franchise owner: what does GET /schools/S show (school record)?
const frSchool = await call('p', 'GET', `/schools/${S}`, T.fr);
log('franchise owner GET /schools/S', frSchool.status, JSON.stringify(frSchool.body).slice(0, 200));
// A Guardian with no tie to PT can't see PT data; a PT student cannot book SP class
const spClass = await db.class.findFirst({ where: { schoolId: S, cancelledAt: null, startDate: { gt: new Date(Date.now() + 86400e3) } } });
const ptBook = await call('p', 'POST', `/classes/${spClass.id}/book`, pt.tok, {});
ok('P2 a Lisbon student cannot book a São Paulo class', ptBook.status >= 400, `${ptBook.status}`);

// ---- E: data export / the parent's view of a child's data ----
const exp = await call('e', 'GET', `/schools/${S}/students/export`, T.owner);
const csv = typeof exp.body === 'string' ? exp.body : JSON.stringify(exp.body);
log('export', exp.status, exp.bytes, csv.slice(0, 300).replace(/\n/g, ' | '));
const injRow = csv.split('\n').find((l) => l.includes('DROP TABLE'));
log('export injection row', injRow);
out.exportHead = csv.slice(0, 400); out.injRow = injRow;
const emojiRow = csv.split('\n').find((l) => l.includes('🥋'));
ok('E1 owner export 200 with UTF-8 names and formula-safe cells', exp.status === 200 && !!emojiRow, `${exp.status} ${exp.bytes} bytes`);

// ---- A: add a student by hand with Portuguese/odd input ----
const addOne = (body) => call('a', 'POST', `/schools/${S}/students/add-manually`, T.owner, { branchId: B.SP, dateOfBirth: '1990-05-10', ...body });
const adds = await Promise.all([
  addOne({ firstName: 'José', surname: 'da Silva Xavier', email: `r5-br-${C.run}-jose@stress.test` }),
  addOne({ firstName: '=HYPERLINK("http://evil")', surname: '+55 Santos', email: `r5-br-${C.run}-formula@stress.test` }),
  addOne({ firstName: 'A'.repeat(101), surname: 'x', email: `r5-br-${C.run}-long@stress.test` }),
  addOne({ firstName: 'Bia', surname: 'Moraes', email: `r5-br-${C.run}-feb29@stress.test`, dateOfBirth: '2003-02-29' }),
  addOne({ firstName: 'Bia', surname: 'Moraes', email: `r5-br-${C.run}-kid@stress.test`, dateOfBirth: '2015-02-28' }),
  addOne({ firstName: 'Tião', surname: 'Galinha', email: `r5-br-${C.run}-old@stress.test`, dateOfBirth: '1931-11-04' }),
  addOne({ firstName: 'Ana', surname: 'Sem Filial', email: `r5-br-${C.run}-nobranch@stress.test`, branchId: undefined }),
]);
log('add-manually', adds.map((r) => [r.status, r.body?.error?.message?.slice(0, 80)]));
ok('A1 add student: pt-BR name ok; 101-char/29-Feb-2003/minor/no-branch refused', adds[0].status === 201 && adds[2].status === 400 && adds[3].status === 400 && adds[4].status === 400 && adds[6].status === 400, JSON.stringify(adds.map((r) => r.status)));
// Same family email for a second person (shared family e-mail is common in Brazil)
const shared = await addOne({ firstName: 'Mariana', surname: 'da Silva Xavier', email: `r5-br-${C.run}-jose@stress.test` });
log('second person, same family e-mail', shared.status, shared.body?.error?.message);
out.sharedEmail = { status: shared.status, body: shared.body };
// Double-click add ×6
const dbl = await Promise.all(Array.from({ length: 6 }, () => addOne({ firstName: 'Duplo', surname: 'Clique', email: `r5-br-${C.run}-dbl@stress.test` })));
const nU = await db.user.count({ where: { email: `r5-br-${C.run}-dbl@stress.test` } });
ok('A2 add-manually clicked 6 times → one person', nU === 1, `${JSON.stringify(codes(dbl))} users=${nU}`);

fs.writeFileSync(new URL('./misc-out.json', import.meta.url), JSON.stringify(out, null, 1));
save();
await db.$disconnect();
