import fs from 'fs';
import { call } from '../../round4/common.mjs';
const c = JSON.parse(fs.readFileSync(new URL('./ng-cast.json', import.meta.url)));
const O = '1fa52957-c05e-49f9-91fa-95aca25fcd4a', st = '0a67789c-5cbd-4816-a4bb-0c9c4db5f64e', tx = '', plan = '0834a734-f0f6-4795-baf4-1ec53e5c5eff';
const rs = await Promise.all([
  call('x', 'GET', `/schools/${O}/students`, c.owner.tok),
  call('x', 'POST', `/schools/${O}/students/${st}/memberships/gift`, c.owner.tok, { membershipPlanId: plan }),
  call('x', 'POST', `/schools/${c.schoolId}/students/${st}/memberships/gift`, c.owner.tok, { membershipPlanId: c.plans.friend }),
  call('x', 'POST', `/schools/${c.schoolId}/desk-payments`, c.owner.tok, { studentId: st, membershipPlanId: c.plans.pack5, paymentMethod: 'CASH' }),
  call('x', 'POST', `/schools/${O}/desk-payments`, c.owner.tok, { studentId: st, membershipPlanId: plan, paymentMethod: 'CASH' }),
  ...(tx ? [call('x', 'POST', `/schools/${O}/charge-payments/${tx}/refund`, c.owner.tok, { amount: 100, destination: 'MONEY_BACK', notes: 'x' }), call('x', 'POST', `/schools/${c.schoolId}/charge-payments/${tx}/refund`, c.owner.tok, { amount: 100, destination: 'MONEY_BACK', notes: 'x' })] : []),
  call('x', 'POST', `/schools/${O}/front-desk/check-ins`, c.staff[0].tok, { studentId: st, classIds: [c.classes.now[0]] }),
  call('x', 'POST', `/schools/${c.schoolId}/front-desk/check-ins`, c.staff[0].tok, { studentId: st, classIds: [c.classes.now[0]] }),
  call('x', 'POST', '/guardians/me/minors/' + st + '/kid-mode-token', c.guardians.okafor.tok, {}),
]);
console.log(rs.map((r) => r.status + ' ' + JSON.stringify(r.body).slice(0, 90)).join('\n'));
process.exit(0);
