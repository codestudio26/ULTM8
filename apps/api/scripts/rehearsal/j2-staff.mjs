// Journey 2: invite Branch Staff, turn on the Payroll switch, and check that
// it gives the payroll report only, with pay rates hidden unless the owner
// turns on "Show pay rates in the report" (Decisions 435 item 22, 436 item 7, 438).
import { call, must, journey, check, ok, step, signUp, signIn } from './lib.mjs';

export async function j2Staff(s) {
  const c = s.cfg;
  if (!s.school) return;
  journey(c.key, '2', 'Staff and payroll');
  const sid = s.school.id;
  const O = () => s.owner.tok;

  // The staff member has their own account; the owner finds them by email and gives the role.
  const [sf, sl] = c.names.staff;
  s.staff = await step('Branch Staff member signs up', () => signUp({ first: sf, last: sl, dob: '1993-09-21', country: c.country, language: c.language, currency: c.currency }));
  if (!s.staff) return;
  const cand = await step('owner finds them by email', () => must('candidate', 'GET', `/schools/${sid}/role-grants/invite-candidate?email=${encodeURIComponent(s.staff.email)}`, O()));
  if (cand) ok('owner finds them by email', cand.found === true && cand.id === s.staff.id, `found=${cand.found}`);
  const grant = await step('owner invites them as Branch Staff', () => must('grant', 'POST', `/users/${s.staff.id}/role-grants`, O(), { role: 'BRANCH_STAFF', schoolId: sid, branchId: s.branch.id }));
  if (grant) ok('owner invites them as Branch Staff', grant.role === 'BRANCH_STAFF' && grant.branchId === s.branch.id, `grant ${grant.id}`);
  await signIn(s.staff);
  const S = () => s.staff.tok;

  // Pay rates are the owner's.
  const rate = await step('owner sets the coach\'s pay rates', () => must('rate', 'PUT', `/schools/${sid}/payroll/rates/${s.owner.id}`, O(), { hourlyRate: 3000, perClassRate: 1500 }));
  if (rate) check('owner sets the coach\'s pay rates', 'PASS', JSON.stringify(rate.items?.find?.((x) => x.userId === s.owner.id) ?? rate).slice(0, 200));

  const before = await call('GET', `/schools/${sid}/payroll/report`, S());
  ok('without the Payroll switch, staff can\'t open the payroll report', before.status === 403, `${before.status} ${before.body?.error?.message ?? ''}`);

  const list = await must('staff list', 'GET', `/schools/${sid}/staff`, O());
  const row = (list.items ?? list).find((x) => x.userId === s.staff.id);
  const access = { ...(row?.access ?? {}), payroll: true };
  const put = await step('owner turns on the Payroll switch', () => must('access', 'PUT', `/schools/${sid}/staff/${s.staff.id}/access`, O(), access));
  if (put) ok('owner turns on the Payroll switch', put.payroll === true || put.access?.payroll === true, JSON.stringify(put).slice(0, 300));

  const rep = await call('GET', `/schools/${sid}/payroll/report`, S());
  const coachRow = rep.body?.rows?.find((x) => x.userId === s.owner.id);
  ok('with the switch, staff open the payroll report', rep.status === 200, `${rep.status}; ${rep.body?.rows?.length ?? 0} rows; totals ${rep.body?.totalClasses} classes, ${rep.body?.totalMinutes} min`);
  ok('rates are hidden from staff by default (page and CSV use the same data)', rep.body?.ratesShown === false && (!coachRow || (coachRow.hourlyRate === null && coachRow.perClassRate === null)),
    `ratesShown=${rep.body?.ratesShown}; coach row ${JSON.stringify(coachRow)}`);
  const ownerRep = await call('GET', `/schools/${sid}/payroll/report`, O());
  const ownerCoach = ownerRep.body?.rows?.find((x) => x.userId === s.owner.id);
  ok('the owner always sees the rates', ownerRep.body?.ratesShown === true && ownerCoach?.hourlyRate === 3000, `ratesShown=${ownerRep.body?.ratesShown}; ${JSON.stringify(ownerCoach)}`);

  const rates = await call('GET', `/schools/${sid}/payroll/rates`, S());
  const setOwn = await call('PUT', `/schools/${sid}/payroll/rates/${s.staff.id}`, S(), { hourlyRate: 99999, perClassRate: 99999 });
  const setOther = await call('PUT', `/schools/${sid}/payroll/rates/${s.owner.id}`, S(), { hourlyRate: 1, perClassRate: 1 });
  ok('report only: staff can\'t open the rates page or change any rate', rates.status === 403 && setOwn.status === 403 && setOther.status === 403, `rates ${rates.status}, own rate ${setOwn.status}, owner's rate ${setOther.status}`);
  const settings = await call('PATCH', `/schools/${sid}`, S(), { payrollStaffSeeRates: true });
  ok('staff can\'t turn "Show pay rates in the report" on themselves', settings.status === 403, `${settings.status}`);

  const on = await step('owner turns on "Show pay rates in the report"', () => must('see rates', 'PATCH', `/schools/${sid}`, O(), { payrollStaffSeeRates: true }));
  if (on) ok('owner turns on "Show pay rates in the report"', on.payrollStaffSeeRates === true, `payrollStaffSeeRates=${on.payrollStaffSeeRates}`);
  const rep2 = await call('GET', `/schools/${sid}/payroll/report`, S());
  const coach2 = rep2.body?.rows?.find((x) => x.userId === s.owner.id);
  ok('then staff see the rates, read only', rep2.body?.ratesShown === true && coach2?.hourlyRate === 3000 && coach2?.perClassRate === 1500, `ratesShown=${rep2.body?.ratesShown}; ${JSON.stringify(coach2)}`);
  const setAfter = await call('PUT', `/schools/${sid}/payroll/rates/${s.owner.id}`, S(), { hourlyRate: 1, perClassRate: 1 });
  ok('and still can\'t change them', setAfter.status === 403, `${setAfter.status}`);
  // Put it back to the default for the rest of the run.
  await call('PATCH', `/schools/${sid}`, O(), { payrollStaffSeeRates: false });

  const tx = await call('GET', `/schools/${sid}/transactions`, S());
  check('Branch Staff and the transactions list (not part of Payroll)', 'NOTE', `GET transactions as Branch Staff: ${tx.status}`);
  // --- Rehearsal 2: a coach and a co-owner; who sees the payment account,
  // who may connect Stripe, who sets staff switches (Decisions 442, 445, 448).
  const T2 = c.key === 'B' ? { coach: ['Thiago', 'Ramos'], co: ['Paula', 'Mendes'] } : { coach: ['Ryan', 'Cole'], co: ['Grace', 'Hill'] };
  s.coach = await step('a coach signs up and is given the Instructor role', async () => {
    const p = await signUp({ first: T2.coach[0], last: T2.coach[1], dob: '1987-02-14', country: c.country, language: c.language, currency: c.currency });
    await must('coach role', 'POST', `/users/${p.id}/role-grants`, O(), { role: 'INSTRUCTOR', schoolId: sid, branchId: s.branch.id });
    await must('coach profile', 'POST', `/schools/${sid}/instructors`, O(), { userId: p.id, branchId: s.branch.id, specializationStyleIds: [s.discipline.id] });
    await signIn(p);
    return p;
  });
  if (s.coach) check('a coach signs up and is given the Instructor role', 'PASS', s.coach.email);
  s.coOwner = await step('the main owner adds a co-owner', async () => {
    const p = await signUp({ first: T2.co[0], last: T2.co[1], dob: '1980-08-08', country: c.country, language: c.language, currency: c.currency });
    await must('co-owner role', 'POST', `/users/${p.id}/role-grants`, O(), { role: 'SCHOOL_OWNER_MANAGER', schoolId: sid });
    await signIn(p);
    return p;
  });
  if (s.coOwner) check('the main owner adds a co-owner', 'PASS', s.coOwner.email);

  // Decision 448 item 9: the payment account record is for the payments area only.
  const paOwner = await call('GET', `/schools/${sid}/payment-account`, O());
  const paStaff = await call('GET', `/schools/${sid}/payment-account`, S());
  const paCoach = await call('GET', `/schools/${sid}/payment-account`, s.coach?.tok);
  ok('the payment account: owner and Branch Staff with a payments permission see it; a coach doesn\'t', paOwner.status === 200 && paStaff.status === 200 && paCoach.status >= 400 && !JSON.stringify(paCoach.body).includes('acct_'),
    `owner ${paOwner.status}; Branch Staff (charges on by default) ${paStaff.status}; coach ${paCoach.status} ${paCoach.body?.error?.code ?? ''}`);
  const row2 = ((await must('staff list', 'GET', `/schools/${sid}/staff`, O())).items ?? []).find((x) => x.userId === s.staff.id);
  await must('charge perms off', 'PUT', `/schools/${sid}/charge-permissions/${s.staff.id}`, O(), { canCreateCharges: false, canCancelCharges: false });
  const paNoPerm = await call('GET', `/schools/${sid}/payment-account`, S());
  ok('Branch Staff with no payments permission don\'t see the payment account', paNoPerm.status >= 400 && paNoPerm.status < 500, `${paNoPerm.status} ${paNoPerm.body?.error?.code ?? paNoPerm.body?.error?.message ?? ''}`);
  await must('charge perms back', 'PUT', `/schools/${sid}/charge-permissions/${s.staff.id}`, O(), { canCreateCharges: true, canCancelCharges: false });

  // Decision 448 item 6: only the main owner sets staff switches.
  if (s.coOwner) {
    const co = await call('PUT', `/schools/${sid}/staff/${s.staff.id}/access`, s.coOwner.tok, { ...(row2?.access ?? {}), staffList: true });
    ok('a co-owner can\'t change staff access switches (main owner only)', co.status === 403 && co.body?.error?.code === 'STAFF_SWITCHES_MAIN_OWNER_ONLY', `${co.status} ${co.body?.error?.code}`);
    const coCharge = await call('PUT', `/schools/${sid}/charge-permissions/${s.staff.id}`, s.coOwner.tok, { canCreateCharges: false, canCancelCharges: true });
    ok('nor the charge permissions', coCharge.status === 403, `${coCharge.status} ${coCharge.body?.error?.code}`);
  }

  // Decision 442 item 3, 445 item 3: who connects Stripe (UK).
  if (c.cards && s.payAcct) {
    const before = await call('POST', `/payment-accounts/${s.payAcct.id}/connect/onboard`, S(), {});
    ok('Branch Staff without "Connect Stripe" can\'t open Stripe onboarding', before.status === 403, `${before.status} ${before.body?.error?.code} ${before.body?.error?.message ?? ''}`);
    const fresh = ((await must('staff list', 'GET', `/schools/${sid}/staff`, O())).items ?? []).find((x) => x.userId === s.staff.id);
    await must('connect switch', 'PUT', `/schools/${sid}/staff/${s.staff.id}/access`, O(), { ...(fresh?.access ?? {}), connectStripe: true });
    const after = await call('POST', `/payment-accounts/${s.payAcct.id}/connect/onboard`, S(), {});
    ok('with "Connect Stripe" on, Branch Staff can continue Stripe onboarding', after.status < 300 && /connect\.stripe\.test/.test(after.body?.onboardingUrl ?? ''), `${after.status}`);
    const create = await call('POST', `/schools/${sid}/payment-accounts`, S(), { provider: 'STRIPE', accountTitle: 'x', country: 'GB' });
    ok('but only an owner chooses how the School is paid (creating the payment account)', create.status === 403, `${create.status} ${create.body?.error?.code ?? create.body?.error?.message ?? ''}`);
    const coOb = s.coOwner ? await call('POST', `/payment-accounts/${s.payAcct.id}/connect/onboard`, s.coOwner.tok, {}) : null;
    const coachOb = await call('POST', `/payment-accounts/${s.payAcct.id}/connect/onboard`, s.coach?.tok, {});
    ok('a co-owner may connect Stripe; a coach may not', coOb?.status < 300 && coachOb.status === 403, `co-owner ${coOb?.status}; coach ${coachOb.status} ${coachOb.body?.error?.code}`);
    await must('connect switch off', 'PUT', `/schools/${sid}/staff/${s.staff.id}/access`, O(), { ...(fresh?.access ?? {}), connectStripe: false });
  }

  const dash = (await call('GET', `/schools/${sid}/dashboard`, O())).body;
  ok('Dashboard checklist ticks "Add staff"', dash?.setupChecklist?.steps?.find((x) => x.key === 'STAFF')?.done === true, JSON.stringify(dash?.setupChecklist?.steps?.find((x) => x.key === 'STAFF')));
}
