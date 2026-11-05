// 18th birthday in India between 00:00 and 05:30 IST (still the 17th-birthday-eve in UTC).
import fs from 'fs';
import { call, grant, tokenRca, db } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId; const t = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const ist = new Date(Date.now() + 5.5 * 3600e3);
const dob = `${ist.getUTCFullYear() - 18}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
const R = Date.now().toString().slice(-6);
const nowInfo = { utc: new Date().toISOString(), ist: ist.toISOString().replace('Z', '+05:30 (IST wall clock)'), dob };
const adult = await call('a', 'POST', `/schools/${S}/students/add-manually`, t, { email: `r5-in-${R}-18a@stress.test`, firstName: 'Birthday', surname: 'Today', dateOfBirth: dob, branchId: C.branches[0] });
const child = await call('c', 'POST', `/schools/${S}/students/add-child-manually`, t, { child: { firstName: 'Birthday', surname: 'Child', dateOfBirth: dob }, guardian: { firstName: 'Amma', surname: 'Today', email: `r5-in-${R}-18g@stress.test` }, branchId: C.branches[0] });
const out = { nowInfo, addAsAdult: `${adult.status} ${JSON.stringify(adult.body).slice(0, 200)}`, addAsChild: `${child.status} ${JSON.stringify(child.body).slice(0, 200)}` };
fs.writeFileSync(new URL('./eighteen-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out);
await db.$disconnect();
