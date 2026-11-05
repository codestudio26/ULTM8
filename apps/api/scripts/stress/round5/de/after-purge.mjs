// After the 90 days and both purge jobs: what can School C's former staff still read?
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { C } = cast; const S = cast.shared.id;
for (const [who, tok] of [['C.owner', C.owner.tok], ['C.staff', C.staff.tok]]) {
  for (const p of [`/schools/${C.id}`, `/schools/${C.id}/students`, `/schools/${C.id}/students/export`, `/schools/${C.id}/students/${S}/notes`, `/schools/${C.id}/students/${S}/profile`, `/schools/${C.id}/notifications/broadcasts`, `/schools/${C.id}/attendance/stats`, `/schools/${C.id}/students/${cast.kidC}/guardians`]) {
    const r = await call('x', 'GET', p, tok);
    const items = r.body?.items?.length;
    console.log(who, 'GET', p.replace(C.id, '{C}').replace(S, '{S}').replace(cast.kidC, '{kidC}'), r.status, items !== undefined ? `items=${items}` : '', JSON.stringify(r.body).slice(0, 180));
  }
}
const me = await call('x', 'GET', '/student-notes/me', cast.shared.tok);
console.log('shared member /notifications/me C items:', JSON.stringify((await call('x', 'GET', '/notifications/me?limit=100', cast.shared.tok)).body).match(/C-BROADCAST/g)?.length ?? 0);
await db.$disconnect();
