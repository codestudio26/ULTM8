// A 10-year-old (Liam, own login, no Guardian) makes a "child", enrols it and signs its waiver.
import fs from 'fs';
import { db, call, grant, tokenRca } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./gb-cast.json', import.meta.url)));
const t = tokenRca(C.users.liam, [grant('STUDENT', C.schoolA, C.branches.lev)]);
const mk = await call('mk', 'POST', '/guardians/me/minors', t, { firstName: 'Probe', surname: 'Walsh', dateOfBirth: '2023-05-01' });
console.log('createMinor', mk.status, JSON.stringify(mk.body));
const j = await call('join', 'POST', `/schools/${C.schoolA}/join`, t, { studentId: mk.body.studentId, branchId: C.branches.lev });
console.log('join', j.status, JSON.stringify(j.body).slice(0, 200));
const s = await call('sign', 'POST', `/waivers/${C.waiverId}/sign`, t, { studentId: mk.body.studentId, signerFullName: 'Liam Walsh', signatureText: 'Liam Walsh' });
console.log('sign for child', s.status, JSON.stringify(s.body).slice(0, 200));
const own = await call('sign self', 'POST', `/waivers/${C.waiverId}/sign`, t, { signerFullName: 'Liam Walsh', signatureText: 'Liam Walsh' });
console.log('sign for himself', own.status, JSON.stringify(own.body).slice(0, 200));
await db.$disconnect(); process.exit(0);
