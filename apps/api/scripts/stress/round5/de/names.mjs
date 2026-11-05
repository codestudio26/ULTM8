// Finding people by name the way a German owner types it (precomposed ü, ß/ss).
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { A } = cast;
const all = (await call('x', 'GET', `/schools/${A.id}/students`, A.owner.tok)).body;
const items = all.items ?? [];
const nfd = items.find((r) => r.firstName === 'Jürgen');
console.log('roster has the NFD-stored "Jürgen Müller":', !!nfd, nfd ? JSON.stringify(nfd.firstName + ' ' + nfd.surname) : '', 'roster size', items.length, 'nextCursor', all.nextCursor ?? null);
for (const q of ['Müller', 'Jürgen', 'Müller', 'Strasse', 'Straßenbahnfahrer', 'STRASSENBAHNFAHRER', 'Nordin', 'محمد', 'Brückner', 'von und zu']) {
  const r = await call('x', 'GET', `/schools/${A.id}/students?search=${encodeURIComponent(q)}`, A.owner.tok);
  const names = (r.body.items ?? []).map((x) => `${x.firstName} ${x.surname}`);
  const hasNfd = names.some((n) => n.includes('Müller'));
  console.log(JSON.stringify(q), r.status, `${names.length} hits`, q.includes('ller') ? `NFD Müller found: ${hasNfd}` : '', names.slice(0, 3).join(' | '));
}
await db.$disconnect();
