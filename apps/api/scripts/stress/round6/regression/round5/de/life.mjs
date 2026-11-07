// Gives the shared member and the shared child real history at A, B and C,
// each item tagged with its School's marker (A-..., B-..., C-...), so the
// cross-School checks can look for another School's marker in a response.
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const out = { waivers: {}, bookings: {}, notes: {}, charges: {}, log: [] };
const L = (k, r) => { out.log.push(`${k} -> ${r.status}${r.status >= 300 ? ' ' + JSON.stringify(r.body).slice(0, 200) : ''}`); return r; };

for (const k of ['A', 'B', 'C']) {
  const s = cast[k];
  const w = L(`${k} waiver`, await call('waiver', 'POST', `/schools/${s.id}/waivers`, s.owner.tok, { title: `${k}-WAIVER Haftungsausschluss`, body: `${k}-WAIVER Ich nehme auf eigene Gefahr teil.` }));
  out.waivers[k] = w.body?.id;
  L(`${k} shared signs`, await call('sign', 'POST', `/waivers/${w.body.id}/sign`, cast.shared.tok, { signerFullName: 'Anna-Lena von Brückner-Weiß', signatureText: 'A.-L. v. B.-W.' }));
  const bk = L(`${k} shared books`, await call('book', 'POST', `/classes/${s.nowClass}/book`, cast.shared.tok, { studentId: cast.shared.id }));
  out.bookings[k] = bk.body?.id ?? bk.body?.booking?.id;
  L(`${k} scan`, await call('scan', 'POST', `/classes/${s.nowClass}/attendance-scan`, s.owner.tok, { studentId: cast.shared.id }));
  const n = L(`${k} note`, await call('note', 'POST', `/schools/${s.id}/students/${cast.shared.id}/notes`, s.owner.tok, { body: `${k}-NOTE vertraulich: Kontaktverbot gegen Ex-Partner`, showToMember: false }));
  out.notes[k] = n.body?.id;
  const c = L(`${k} charge`, await call('charge', 'POST', `/schools/${s.id}/students/${cast.shared.id}/charges`, s.owner.tok, { description: `${k}-CHARGE Prüfungsgebühr`, amount: 2500, dueDate: '2026-12-01' }));
  out.charges[k] = c.body?.id;
  L(`${k} broadcast`, await call('bc', 'POST', `/schools/${s.id}/notifications/broadcast`, s.owner.tok, { title: `${k}-BROADCAST Hallenschließung`, body: `${k}-BROADCAST Die Halle bleibt am Montag zu.`, audience: 'ALL' }));
  L(`${k} tag`, await call('tag', 'POST', `/schools/${s.id}/student-tags`, s.owner.tok, { name: `${k}-TAG säumig` }));
  L(`${k} checkin code`, await call('code', 'POST', `/schools/${s.id}/students/${cast.shared.id}/check-in-code`, s.owner.tok, {}));
}
// The child at A and B: father signs and books at both; mother at A.
for (const k of ['A', 'B']) {
  const s = cast[k];
  L(`${k} father signs for kidAB`, await call('sign', 'POST', `/waivers/${out.waivers[k]}/sign`, cast.father.tok, { studentId: cast.kidAB, signerFullName: 'Murat Öztürk', signatureText: 'M. Öztürk' }));
  L(`${k} kidAB booked by father`, await call('book', 'POST', `/classes/${s.nowClass}/book`, cast.father.tok, { studentId: cast.kidAB }));
  L(`${k} kidAB scan`, await call('scan', 'POST', `/classes/${s.nowClass}/attendance-scan`, s.owner.tok, { studentId: cast.kidAB }));
  L(`${k} kidAB note`, await call('note', 'POST', `/schools/${s.id}/students/${cast.kidAB}/notes`, s.owner.tok, { body: `${k}-NOTE-KID Sorgerecht: nur Vater darf abholen`, showToMember: false }));
}
L('C gC signs for kidC', await call('sign', 'POST', `/waivers/${out.waivers.C}/sign`, cast.gC.tok, { studentId: cast.kidC, signerFullName: 'Uta Köpenick', signatureText: 'U. K.' }));
L('C kidC booked', await call('book', 'POST', `/classes/${cast.C.nowClass}/book`, cast.gC.tok, { studentId: cast.kidC }));
L('C kidC scan', await call('scan', 'POST', `/classes/${cast.C.nowClass}/attendance-scan`, cast.C.owner.tok, { studentId: cast.kidC }));
for (const st of cast.studentsC.slice(0, 10)) {
  L('C st signs', await call('sign', 'POST', `/waivers/${out.waivers.C}/sign`, st.tok, { signerFullName: 'Mitglied C', signatureText: 'MC' }));
  L('C st books', await call('book', 'POST', `/classes/${cast.C.nowClass}/book`, st.tok, { studentId: st.id }));
  L('C st scan', await call('scan', 'POST', `/classes/${cast.C.nowClass}/attendance-scan`, cast.C.owner.tok, { studentId: st.id }));
}
// A: 120 members book and get scanned (a Verein evening), half sign.
const some = cast.studentsA.slice(0, 120);
for (const st of some) {
  await call('A book', 'POST', `/classes/${cast.A.futureClass}/book`, st.tok, { studentId: st.id });
}
fs.writeFileSync(new URL('./cast-life.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.log.join('\n'));
await db.$disconnect();
