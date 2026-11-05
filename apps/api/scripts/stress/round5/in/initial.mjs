import fs from 'fs';
import { call, grant, tokenRca, db, randomUUID } from '../../round4/common.mjs';
const C = JSON.parse(fs.readFileSync(new URL('./in-cast.json', import.meta.url)));
const S = C.schoolId; const t = tokenRca(C.owner, [grant('SCHOOL_OWNER_MANAGER', S)]);
const R = Date.now().toString().slice(-6);
const people = [['Zoya', 'ख़ान'.normalize('NFC')], ['Srinivas', 'ஸ்ரீநிவாசன்'], ['Kshitij', 'क्षत्रिय'], ['Emoji', '𝒜rjun']];
for (const [f, s] of people) { const u = { id: randomUUID(), email: `r5-in-${R}-${f}@stress.test`, firstName: `${f}${R}`, surname: s, passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') }; await db.user.create({ data: u }); await db.roleGrant.create({ data: { id: randomUUID(), userId: u.id, role: 'STUDENT', schoolId: S, branchId: C.branches[0] } }); await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: S, studentId: u.id, branchId: C.branches[0] } }); }
const sess = await call('s', 'POST', `/schools/${S}/front-desk/sessions`, t, { branchId: C.branches[0] });
const out = [];
for (const [f, s] of people) { const r = await call('k', 'GET', `/front-desk/kiosk/students?search=${encodeURIComponent(f + R)}`, sess.body.sessionToken); const it = (r.body?.items || [])[0]; out.push({ surname: s, shown: it?.surnameInitial, codepoints: it ? [...it.surnameInitial].map((c) => c.codePointAt(0).toString(16)) : r.status, json: JSON.stringify(it?.surnameInitial) }); }
fs.writeFileSync(new URL('./initial-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out);
await db.$disconnect();
