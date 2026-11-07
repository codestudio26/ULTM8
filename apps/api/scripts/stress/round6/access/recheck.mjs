// Round 6 P — each finding re-run on a CLEAN School made just for it (nothing
// from world.json), so a result can't come from the harness's earlier steps.
//   P-1  an erased coach's coach profile (phone, bio, photo) stays visible
//   P-2  a locked (deleting) member's waiting Pix order can still be confirmed
//   P-3  staff with "Can connect Stripe" decide the payment model before the owner
//   Q    a member the School adds by hand never ticks "I agree"
import { call, must, signUp, signIn, stepUp, runJob, db, rec, saveResults, RUN, sleep } from './lib.mjs';

const A = 'recheck';
const uniq = RUN.replace(/[^a-z0-9]/gi, '');
async function school(country) {
  const br = country === 'BR';
  const addr = br ? { line1: 'Rua Y, 2', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' } : { line1: '2 Low St', city: 'London', postalCode: 'E1 6AN', country: 'GB' };
  const o = await signUp({ first: 'Cleo', last: `Owner${uniq}`, country, language: br ? 'pt-BR' : 'en-GB', currency: br ? 'BRL' : 'GBP' });
  const s = await must('school', 'POST', '/schools', o.tok, { name: `R6P clean ${country} ${uniq} ${Date.now()}`, timezone: br ? 'America/Sao_Paulo' : 'Europe/London', defaultCurrency: br ? 'BRL' : 'GBP', defaultLanguage: br ? 'pt-BR' : 'en-GB', postalAddress: addr, ranksToggle: true, acceptAgreement: true });
  await signIn(o);
  const b = await must('branch', 'POST', `/schools/${s.id}/branches`, o.tok, { name: 'Main', postalAddress: addr });
  const style = await must('style', 'POST', `/schools/${s.id}/disciplines/from-template`, o.tok, { templateId: 'ibjjf', name: 'BJJ' });
  return { o, s, b, style, br };
}

// --- P-1 ---------------------------------------------------------------------------
{
  const { o, s, b, style } = await school('GB');
  const SUR = `Coachy${uniq}`;
  const coach = await signUp({ first: 'Remy', last: SUR });
  await must('grant', 'POST', `/users/${coach.id}/role-grants`, o.tok, { role: 'INSTRUCTOR', schoolId: s.id, branchId: b.id });
  await signIn(coach);
  const inst = await must('profile', 'POST', `/schools/${s.id}/instructors`, o.tok, { userId: coach.id, branchId: b.id, specializationStyleIds: [style.id], phone: '+447911123987', bio: `${SUR} trains in Leeds.`, photoUrl: `https://ci-test-public-photos.example.test/instructors/${SUR}.jpg` });
  const member = await signUp({ first: 'Mo', last: `Member${uniq}` });
  await must('join', 'POST', `/schools/${s.id}/join`, member.tok, { branchId: b.id });
  await signIn(member);
  const su = await stepUp(coach);
  await must('delete', 'POST', '/users/me/deletion', coach.tok, undefined, { 'x-step-up-token': su });
  await db.user.update({ where: { id: coach.id }, data: { deletionDueAt: new Date(Date.now() - 60e3) } });
  await runJob('account-erasure');
  const u = await db.user.findUnique({ where: { id: coach.id } });
  const list = await call('GET', `/schools/${s.id}/instructors`, member.tok);
  const mine = (list.body?.items ?? list.body ?? []).find?.((x) => x.id === inst.id || x.userId === coach.id);
  rec(A, 'P-1 erased coach: a member still sees the coach profile phone/bio/photo', !(mine && (mine.phone || /Coachy/.test(mine.bio ?? '') || mine.photoUrl)),
    `erased=${!!u.erasedAt} name=${u.firstName} ${u.surname}; member sees: ${JSON.stringify({ name: mine?.firstName ?? mine?.user?.firstName, phone: mine?.phone, bio: mine?.bio, photoUrl: mine?.photoUrl, archivedAt: mine?.archivedAt })}`);
  const one = await call('GET', `/instructors/${inst.id}`, member.tok);
  rec(A, 'P-1 …and on the coach page', !(one.body?.phone || /Coachy/.test(one.body?.bio ?? '')), `${one.status} phone=${one.body?.phone} bio=${one.body?.bio}`);
}

// --- P-2 ---------------------------------------------------------------------------
{
  const { o, s, b } = await school('BR');
  await must('pix', 'POST', `/schools/${s.id}/payment-accounts`, o.tok, { provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' });
  await must('record payments', 'PATCH', `/schools/${s.id}`, o.tok, { branchStaffCanRecordPayments: true });
  const plan = await must('plan', 'POST', `/schools/${s.id}/membership-plans`, o.tok, { currency: 'BRL', type: 'CLASS_PACK', title: 'Pacote', price: 9000, classesIncluded: 10, expiryDurationDays: 90 });
  const staff = await signUp({ first: 'Tita', last: `Staff${uniq}`, country: 'BR', language: 'pt-BR', currency: 'BRL' });
  await must('staff', 'POST', `/users/${staff.id}/role-grants`, o.tok, { role: 'BRANCH_STAFF', schoolId: s.id, branchId: b.id });
  await signIn(staff);
  const m = await signUp({ first: 'Lia', last: `Member${uniq}`, country: 'BR', language: 'pt-BR', currency: 'BRL' });
  await must('join', 'POST', `/schools/${s.id}/join`, m.tok, { branchId: b.id });
  await signIn(m);
  const ord = await must('order', 'POST', `/membership-plans/${plan.id}/purchase`, m.tok, {});
  const su = await stepUp(m);
  await must('delete', 'POST', '/users/me/deletion', m.tok, undefined, { 'x-step-up-token': su });
  const desk = await call('POST', `/schools/${s.id}/students/${m.id}/memberships/sell`, o.tok, { membershipPlanId: plan.id, paymentMethod: 'CASH' });
  const c = await call('PATCH', `/transactions/${ord.transactionId}/confirm`, staff.tok, {});
  const ms = await db.membership.findFirst({ where: { studentId: m.id, schoolId: s.id, status: 'ACTIVE' } });
  rec(A, "P-2 locked member: desk sale refused but staff confirm of the waiting Pix order starts an Active plan", !(desk.status === 403 && c.status < 300 && ms),
    `desk sell ${desk.status} ${desk.body?.error?.code}; staff confirm ${c.status}; active membership=${!!ms}; deletion pending=${!!(await db.user.findUnique({ where: { id: m.id } })).deletionRequestedAt}`);
  await sleep(1500);
  const told = await db.notification.findMany({ where: { userId: m.id, type: 'CASH_PAYMENT' }, select: { title: true } });
  rec(A, 'P-2 …the locked member is sent the "confirmed" notice', null, JSON.stringify(told));
}

// --- P-3 ---------------------------------------------------------------------------
for (const country of ['BR', 'GB']) {
  const { o, s, b } = await school(country);
  const st = await signUp({ first: 'Pia', last: `Stripe${uniq}`, country });
  await must('staff', 'POST', `/users/${st.id}/role-grants`, o.tok, { role: 'BRANCH_STAFF', schoolId: s.id, branchId: b.id });
  await signIn(st);
  const row = ((await must('list', 'GET', `/schools/${s.id}/staff`, o.tok)).items ?? []).find((x) => x.userId === st.id);
  await must('switch', 'PUT', `/schools/${s.id}/staff/${st.id}/access`, o.tok, { ...(row?.access ?? {}), connectStripe: true });
  const mk = await call('POST', `/schools/${s.id}/payment-accounts`, st.tok, { provider: 'STRIPE', accountTitle: 'Cards', country });
  const ob = mk.status < 300 ? await call('POST', `/payment-accounts/${mk.body.id}/connect/onboard`, st.tok, {}) : null;
  const pix = await call('POST', `/schools/${s.id}/payment-accounts`, o.tok, { provider: 'BANK_TRANSFER', accountTitle: 'Bank', country });
  rec(A, `P-3 ${country}: switched-on staff create the Stripe account first; the owner then can't choose bank transfer`, !(mk.status < 300 && pix.status >= 400),
    `staff STRIPE ${mk.status} connectAvailable=${mk.body?.connectAvailable}; onboard ${ob?.status} ${ob?.body?.error?.code ?? ''}; owner BANK_TRANSFER ${pix.status} "${pix.body?.error?.message ?? ''}"`);
  if (country === 'GB' && mk.status < 300) {
    // The status read saves Stripe's answer in the staff member's own context.
    await db.paymentAccount.update({ where: { id: mk.body.id }, data: { stripeAccountReady: true } });
    const r = await call('GET', `/schools/${s.id}/payment-account/connect-status`, st.tok);
    const pa = await db.paymentAccount.findUnique({ where: { id: mk.body.id } });
    rec(A, "connect-status read by switched-on staff saves Stripe's answer without an error", r.status === 200 && pa.stripeAccountReady === false, `${r.status} ${r.body?.status ?? r.body?.error?.message} saved=${pa.stripeAccountReady}`);
  }
}

// --- Q: a member the School adds by hand -------------------------------------------
{
  const { o, s, b } = await school('GB');
  const email = `manual.${uniq}@r6p.test`;
  const r = await must('add manually', 'POST', `/schools/${s.id}/students/add-manually`, o.tok, { firstName: 'Manny', surname: `Manual${uniq}`, email, dateOfBirth: '1992-02-02', branchId: b.id });
  const temp = r.tempPasscode ?? r.temporaryPasscode;
  const li = await call('POST', '/auth/login', null, { email, passcode: temp });
  let changed = null;
  if (li.status < 300) changed = await call('POST', '/auth/passcode-change/first-login', li.body.accessToken, { newPasscode: '615243' });
  const user = await db.user.findFirst({ where: { email } });
  const rows = user ? await db.legalAcceptance.count({ where: { userId: user.id } }) : -1;
  rec(A, 'Q: a member added by hand signs in and sets a passcode without ever ticking "I agree"', null, `temp login ${li.status}; first-login change ${changed?.status}; LegalAcceptance rows ${rows}`);
}
saveResults('recheck');
await db.$disconnect();
