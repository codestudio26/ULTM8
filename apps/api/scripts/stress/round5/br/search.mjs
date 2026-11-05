// Name search on the Students page the way a Brazilian front desk types.
import fs from 'fs';
import { call } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./cast-br.json', import.meta.url)));
const out = {};
for (const s of ['Conceição', 'Conceicao', 'conceição dos santos', 'João', 'Joao', 'Ênio', 'Enio', "D'Ávila", 'Davila', 'محمد', '🥋', '%', "'; DROP", 'Maria da Gloria', 'Maria da Glória']) {
  const r = await call('n', 'GET', `/schools/${C.S}/students?search=${encodeURIComponent(s)}`, C.tok.owner);
  const items = r.body?.items ?? r.body ?? [];
  out[s] = { status: r.status, n: items.length, nfdJoaoFound: items.some((x) => x.id === C.special.combining) };
}
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('./search-out.json', import.meta.url), JSON.stringify(out, null, 1));
