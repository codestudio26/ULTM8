// R-3 repro: GET /schools/:id/students/export for someone with no role at that School.
import { cast, call } from '../round4/common.mjs';
import { randomUUID } from 'crypto';
const a = cast.schools[3], b = cast.schools[4];
for (const [label, id] of [['another School (exists)', b.id], ['a School id that does not exist', randomUUID()]]) {
  const ex = await call('x', 'GET', `/schools/${id}/students/export`, a.owner.tok);
  const ro = await call('x', 'GET', `/schools/${id}/students`, a.owner.tok);
  console.log(`School A's owner → ${label}: export ${ex.status} ${JSON.stringify(ex.body?.error)}; roster ${ro.status} ${JSON.stringify(ro.body?.error)}`);
}
