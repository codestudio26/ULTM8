// Supplement: staff book the children (a Guardian books through Kid Mode), then scan.
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
for (const [k, kid] of [['A', cast.kidAB], ['B', cast.kidAB], ['C', cast.kidC], ['A', cast.kidA]]) {
  const s = cast[k];
  const b = await call('b', 'POST', `/classes/${s.nowClass}/book`, s.owner.tok, { studentId: kid });
  const c = await call('c', 'POST', `/classes/${s.nowClass}/attendance-scan`, s.owner.tok, { studentId: kid });
  console.log(k, kid.slice(0, 8), b.status, c.status, b.status >= 300 ? JSON.stringify(b.body) : '');
}
await db.$disconnect();
