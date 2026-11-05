// School B's owner edits the shared child's and shared member's profile: does School A see it?
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const cast = JSON.parse(fs.readFileSync(new URL('./cast-de.json', import.meta.url)));
const { A, B } = cast; const S = cast.shared.id, K = cast.kidAB;
const before = await call('x', 'GET', `/schools/${A.id}/students/${K}/profile`, A.owner.tok);
console.log('A sees kid before:', before.body.firstName, before.body.dateOfBirth);
const p1 = await call('x', 'PATCH', `/schools/${B.id}/students/${K}/profile`, B.owner.tok, { dateOfBirth: '2000-01-01', firstName: 'Emil (B hat geändert)', emergencyContactName: 'B-EMERGENCY Nachbar', emergencyContactPhone: '+4930123456' });
console.log('B PATCH kid profile:', p1.status, JSON.stringify(p1.body).slice(0, 160));
const after = await call('x', 'GET', `/schools/${A.id}/students/${K}/profile`, A.owner.tok);
console.log('A sees kid after:', after.body.firstName, after.body.dateOfBirth, after.body.emergencyContactName);
const p2 = await call('x', 'PATCH', `/schools/${B.id}/students/${S}/profile`, B.owner.tok, { addressLine1: 'B-ADDRESS Geheimweg 1', nationality: 'DE', weightCategory: '-63kg' });
console.log('B PATCH shared member profile:', p2.status);
const a2 = await call('x', 'GET', `/schools/${A.id}/students/${S}/profile`, A.owner.tok);
console.log('A sees shared member after:', a2.body.addressLine1, a2.body.weightCategory);
// Does the kid now count as an adult at A? (waiver signing on their own)
const mine = await call('x', 'GET', `/students/${K}/waiver-status?schoolId=${A.id}`, A.owner.tok);
console.log('A waiver-status for kid:', mine.status, JSON.stringify(mine.body).slice(0, 300));
// undo the DOB so other checks keep their meaning
const undo = await call('x', 'PATCH', `/schools/${A.id}/students/${K}/profile`, A.owner.tok, { dateOfBirth: before.body.dateOfBirth.slice(0, 10), firstName: 'Emil' });
console.log('undo by A:', undo.status);
await db.$disconnect();
