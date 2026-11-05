// NG: what a walk-in typed on the tablet (phone, emergency contact) after staff approve it.
import fs from 'fs';
import { db, call } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('./ng-cast.json', import.meta.url)));
const sess = await call('t', 'POST', `/schools/${c.schoolId}/front-desk/sessions`, c.staff[0].tok, { branchId: c.branches.island });
const email = `r5-ng-${c.run}-walkin2-${Date.now() % 1e6}@stress.test`;
const su = await call('su', 'POST', '/front-desk/kiosk/sign-ups', sess.body.sessionToken, { kind: 'MEMBER', firstName: 'Abubakar', surname: 'Danjuma', dateOfBirth: '1990-01-15', email, phone: '+2348091112233', emergencyName: 'Hauwa Danjuma', emergencyPhone: '+2348094445566', emergencyRelationship: 'Wife' });
console.log('sign-up', su.status, JSON.stringify(su.body));
const ap = await call('ap', 'POST', `/schools/${c.schoolId}/sign-ups/${su.body.id}/approve`, c.owner.tok, {});
console.log('approve', ap.status, JSON.stringify(ap.body).slice(0, 300));
const u = await db.user.findUnique({ where: { email }, select: { phone: true, secondaryPhone: true, emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelationship: true } });
const s = await db.signUp.findUnique({ where: { id: su.body.id }, select: { phone: true, emergencyName: true, emergencyPhone: true, emergencyRelationship: true, status: true } });
console.log('account', JSON.stringify(u)); console.log('sign-up row', JSON.stringify(s));
await db.$disconnect();
