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
  const dash = (await call('GET', `/schools/${sid}/dashboard`, O())).body;
  ok('Dashboard checklist ticks "Add staff"', dash?.setupChecklist?.steps?.find((x) => x.key === 'STAFF')?.done === true, JSON.stringify(dash?.setupChecklist?.steps?.find((x) => x.key === 'STAFF')));
}
