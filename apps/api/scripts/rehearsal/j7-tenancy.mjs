// Journey 7: School A's people can never see or change School B's data, and
// the other way round. Spot checks on the main endpoints, as the owner, Branch
// Staff and a member of the other School (rehearsal 2: also the co-owner and a coach).
import { call, journey, check, ok, db } from './lib.mjs';

function targets(t) {
  const sid = t.school.id;
  const tx = t.adultPackTx;
  return {
    reads: [
      `/schools/${sid}`, `/schools/${sid}/dashboard`, `/schools/${sid}/students`, `/schools/${sid}/students/export`, `/schools/${sid}/staff`,
      `/schools/${sid}/transactions`, `/schools/${sid}/transactions/summary`, `/schools/${sid}/payroll/report`, `/schools/${sid}/payroll/rates`,
      `/schools/${sid}/waivers/${t.waiver.id}/signatures`, `/schools/${sid}/students/${t.adult.id}/profile`, `/schools/${sid}/students/${t.adult.id}/notes`,
      `/schools/${sid}/students/${t.adult.id}/files`, `/schools/${sid}/students/${t.adult.id}/memberships`, `/schools/${sid}/students/${t.adult.id}/guardians`,
      `/schools/${sid}/freezes`, `/schools/${sid}/cancellations`, `/schools/${sid}/payment-account`, `/schools/${sid}/card-surcharge`,
      `/classes/${t.nowClass.id}/bookings`, `/classes/${t.nowClass.id}/qr-token`, `/classes/${t.smallClass.id}/waitlist`, `/membership-plans/${t.plans.pack.id}/waitlist`,
      `/membership-plans/${t.plans.pack.id}/members`, `/students/${t.adult.id}/bookings`, `/students/${t.adult.id}/waiver-status`, `/students/${t.adult.id}/membership-status`,
      ...(tx ? [`/transactions/${tx}/invoice`] : []), `/guardians/me/minors/${t.child.id}/consent`, `/guardians/me/minors/${t.child.id}/waivers`,
      // Rehearsal 2: what was built since rehearsal 1.
      `/schools/${sid}/payment-account/connect-status`, `/schools/${sid}/students/${t.adult.id}/charges`, `/schools/${sid}/students/${t.adult.id}/recurring-charges`,
      `/schools/${sid}/charge-reports/overview`, `/schools/${sid}/charge-permissions`, `/schools/${sid}/sign-ups`, `/schools/${sid}/imports/limits`, `/schools/${sid}/front-desk/sessions`,
    ],
    writes: [
      ['PATCH', `/schools/${sid}`, { description: 'cross-tenant' }],
      ['POST', `/schools/${sid}/students/${t.adult.id}/notes`, { body: 'cross-tenant note' }],
      ['POST', `/schools/${sid}/students/${t.adult.id}/memberships/sell`, { membershipPlanId: t.plans.week.id, paymentMethod: 'CASH' }],
      ['POST', `/students/${t.adult.id}/ranks/${t.discipline.id}/promote`, {}],
      ['PUT', `/schools/${sid}/payroll/rates/${t.owner.id}`, { hourlyRate: 1, perClassRate: 1 }],
      ['POST', `/schools/${sid}/waivers`, { title: 'x', body: 'x' }],
      ['POST', `/schools/${sid}/membership-plans`, { type: 'CLASS_PACK', title: 'x', price: 1, classesIncluded: 1 }],
      ['POST', `/classes/${t.smallClass.id}/book`, { studentId: t.child.id }],
      ['POST', `/schools/${sid}/front-desk/check-ins`, { studentId: t.child.id, classIds: [t.nowClass.id] }],
      ...(tx ? [['PATCH', `/transactions/${tx}/confirm`, {}], ['PATCH', `/transactions/${tx}/cancel`, { reason: 'x' }], ['POST', `/transactions/${tx}/refund`, { amount: 1, notes: 'x' }]] : []),
      ['POST', `/membership-plans/${t.plans.pack.id}/archive`, {}],
      ['PUT', `/schools/${sid}/staff/${t.staff.id}/access`, { payroll: true }],
      ['PATCH', `/schools/${sid}/students/${t.adult.id}/profile`, { emergencyContactName: 'cross-tenant' }],
      ['POST', `/schools/${sid}/students/${t.adult.id}/charges`, { description: 'cross-tenant', amount: 100, dueDate: '2027-01-01' }],
      ['POST', `/schools/${sid}/students/${t.adult.id}/charge-payments`, { amount: 100, paymentMethod: 'CASH' }],
      ['POST', `/schools/${sid}/payment-accounts`, { provider: 'BANK_TRANSFER', accountTitle: 'x', country: t.cfg.country }],
      ...(t.payAcct ? [['POST', `/payment-accounts/${t.payAcct.id}/connect/onboard`, {}]] : []),
      ['PUT', `/schools/${sid}/charge-permissions/${t.staff.id}`, { canCreateCharges: true, canCancelCharges: true }],
      ['POST', `/schools/${sid}/front-desk/sessions`, {}],
      ['POST', `/schools/${sid}/imports`, { kind: 'ATTENDANCE', totalRows: 1 }],
      ['PATCH', `/schools/${sid}`, { branchStaffCanRecordPayments: true }],
    ],
  };
}

export async function j7Tenancy(ctx) {
  const pairs = [['A', 'B'], ['B', 'A']];
  for (const [from, to] of pairs) {
    const f = ctx[from], t = ctx[to];
    journey(`${from}→${to}`, '7', 'Cross-tenant');
    if (!f?.owner || !t?.adult || !t?.child || !t?.staff) { check('cross-tenant spot checks', 'BLOCKED', 'earlier journeys did not finish'); continue; }
    const { reads, writes } = targets(t);
    const secrets = [t.adult.email, t.adult.last, t.child.last, t.school.name, t.staff.email].filter(Boolean);
    for (const [who, person] of [['owner', f.owner], ['co-owner', f.coOwner], ['Branch Staff', f.staff], ['coach', f.coach], ['member', f.adult], ['parent', f.parent]]) {
      if (!person?.tok) continue;
      const leaks = [], allowed = [], serverErrors = [];
      for (const p of reads) {
        const r = await call('GET', p, person.tok);
        const text = JSON.stringify(r.body ?? '');
        if (r.status >= 500) serverErrors.push(`${r.status} GET ${p}`);
        else if (r.status < 300) allowed.push(`GET ${p}`);
        if (secrets.some((x) => text.includes(x))) leaks.push(`GET ${p} (${r.status})`);
      }
      for (const [m, p, b] of writes) {
        const r = await call(m, p, person.tok, b);
        if (r.status >= 500) serverErrors.push(`${r.status} ${m} ${p}`);
        else if (r.status < 300) allowed.push(`${m} ${p}`);
        if (secrets.some((x) => JSON.stringify(r.body ?? '').includes(x))) leaks.push(`${m} ${p} (${r.status})`);
      }
      ok(`${from}'s ${who} can't read or change ${to}'s data (${reads.length} reads, ${writes.length} writes)`, leaks.length === 0 && allowed.length === 0 && serverErrors.length === 0,
        `allowed: ${allowed.join(', ') || 'none'}; leaks: ${leaks.join(', ') || 'none'}; 5xx: ${serverErrors.join(', ') || 'none'}`);
      // Decision 448 item 17: a page an owner's switch refuses answers "not
      // found" to someone with no role at the School.
      const gated = [`/schools/${t.school.id}/payroll/report`, `/schools/${t.school.id}/staff`, `/schools/${t.school.id}/students/export`, `/schools/${t.school.id}/payment-account`,
        `/schools/${t.school.id}/students/${t.adult.id}/files`, `/schools/${t.school.id}/imports/limits`, `/schools/${t.school.id}/freezes`, `/schools/${t.school.id}/sign-ups`];
      const not404 = [];
      for (const p of gated) { const r = await call('GET', p, person.tok); if (r.status !== 404) not404.push(`${r.status} ${p.replace(t.school.id, ':school').replace(t.adult.id, ':student')}`); }
      if (t.payAcct) { const r = await call('POST', `/payment-accounts/${t.payAcct.id}/connect/onboard`, person.tok, {}); if (r.status !== 404) not404.push(`${r.status} POST connect/onboard`); }
      ok(`${from}'s ${who} gets "not found" (404) from ${to}'s switch-gated pages`, not404.length === 0, not404.join(', ') || `all ${gated.length + (t.payAcct ? 1 : 0)} answered 404`);
    }
    // Nothing was written by the attempts.
    const notes = await db.studentNote.count({ where: { studentId: t.adult.id, body: 'cross-tenant note' } });
    const plans = await db.membershipPlan.count({ where: { schoolId: t.school.id, title: 'x' } });
    const school = await db.school.findUnique({ where: { id: t.school.id } });
    const accts = await db.paymentAccount.count({ where: { schoolId: t.school.id } });
    const charges = await db.charge.count({ where: { schoolId: t.school.id, description: 'cross-tenant' } });
    const prof = await db.user.findUnique({ where: { id: t.adult.id } });
    ok(`nothing of ${to}'s changed`, notes === 0 && plans === 0 && school.description !== 'cross-tenant' && accts === 1 && charges === 0 && prof.emergencyContactName !== 'cross-tenant' && school.branchStaffCanRecordPayments === !t.cfg.cards,
      `notes ${notes}, plans ${plans}, description ${school.description}, payment accounts ${accts}, charges ${charges}, profile ${prof.emergencyContactName}, record-payments switch ${school.branchStaffCanRecordPayments}`);
  }
}
