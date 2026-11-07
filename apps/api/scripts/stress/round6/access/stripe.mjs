// Round 6 P — "Can connect Stripe" (#514, Decision 442 item 3 / 443 item 3)
// and who may grant it / grant roles (Decision 423 item 10). School A (GB)
// starts with no payment account.
import { call, must, signUp, signIn, db, rec, refused, saveResults, loadWorld, refreshAll } from './lib.mjs';

const A = 'stripe';
const w = loadWorld();
await refreshAll(w);
const SA = w.schools.A, SB = w.schools.B;
const P = SA.people, PB = SB.people;
const FAKE = `http://localhost:${process.env.FAKE_STRIPE_PORT}`;
const acctBody = (provider) => ({ provider, accountTitle: provider === 'STRIPE' ? 'Cards' : 'Bank', country: 'GB' });

// --- who may grant the switch ----------------------------------------------------
const staffRow = async (uid) => ((await must('staff', 'GET', `/schools/${SA.id}/staff`, P.owner.tok)).items ?? []).find((x) => x.userId === uid);
const accessOf = async (uid) => (await staffRow(uid))?.access ?? {};
refused(A, "staff can't give themselves Can connect Stripe", await call('PUT', `/schools/${SA.id}/staff/${P.staff1.id}/access`, P.staff1.tok, { ...(await accessOf(P.staff1.id)), connectStripe: true }), [403]);
refused(A, "a staff member with it can't give it to another", await call('PUT', `/schools/${SA.id}/staff/${P.staff2.id}/access`, P.staffStripe.tok, { ...(await accessOf(P.staff2.id)), connectStripe: true }), [403]);
refused(A, "a coach can't give it", await call('PUT', `/schools/${SA.id}/staff/${P.staff1.id}/access`, P.coach.tok, { ...(await accessOf(P.staff1.id)), connectStripe: true }), [403]);
refused(A, "School B's owner can't give it at School A", await call('PUT', `/schools/${SA.id}/staff/${P.staff1.id}/access`, PB.owner.tok, { ...(await accessOf(P.staff1.id)), connectStripe: true }), [403, 404]);
const coachGrant = await call('PUT', `/schools/${SA.id}/staff/${P.coach.id}/access`, P.owner.tok, { ...(await accessOf(P.staff1.id)), connectStripe: true });
rec(A, 'a coach (Instructor only) cannot be given it (Decision 443 item 3)', coachGrant.status === 400, `${coachGrant.status} ${coachGrant.body?.error?.message ?? ''}`);
// Co-owner setting a staff switch: Decision 423 item 10 makes roles main-owner only; switches?
const coSet = await call('PUT', `/schools/${SA.id}/staff/${P.staff2.id}/access`, P.coowner.tok, { ...(await accessOf(P.staff2.id)), connectStripe: false });
rec(A, 'co-owner sets a staff access switch (roles are main-owner only; switches not said)', null, `${coSet.status} ${coSet.body?.error?.message ?? ''}`);
// Decision 423 item 10: roles.
const extra = await signUp({ first: 'Rolf', last: 'Rolecheck' });
refused(A, "co-owner can't add a role (Decision 423 item 10)", await call('POST', `/users/${extra.id}/role-grants`, P.coowner.tok, { role: 'BRANCH_STAFF', schoolId: SA.id, branchId: SA.b1 }), [403]);
refused(A, "staff can't add a role", await call('POST', `/users/${extra.id}/role-grants`, P.staffStripe.tok, { role: 'INSTRUCTOR', schoolId: SA.id, branchId: SA.b1 }), [403]);
refused(A, "coach can't add a role", await call('POST', `/users/${extra.id}/role-grants`, P.coach.tok, { role: 'INSTRUCTOR', schoolId: SA.id, branchId: SA.b1 }), [403]);
const g1 = await db.roleGrant.findFirst({ where: { userId: P.staff2.id, schoolId: SA.id, revokedAt: null } });
refused(A, "co-owner can't remove a role", await call('DELETE', `/users/${P.staff2.id}/role-grants/${g1.id}`, P.coowner.tok), [403]);
const ownerGrant = await db.roleGrant.findFirst({ where: { userId: P.owner.id, schoolId: SA.id, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null } });
refused(A, "co-owner can't remove the main owner", await call('DELETE', `/users/${P.owner.id}/role-grants/${ownerGrant.id}`, P.coowner.tok), [403]);

// --- creating the School's payment account ---------------------------------------
refused(A, "staff without the switch can't create a Stripe account", await call('POST', `/schools/${SA.id}/payment-accounts`, P.staff1.tok, acctBody('STRIPE')), [403]);
refused(A, "coach can't create a Stripe account", await call('POST', `/schools/${SA.id}/payment-accounts`, P.coach.tok, acctBody('STRIPE')), [403]);
refused(A, "a member can't", await call('POST', `/schools/${SA.id}/payment-accounts`, P.adult1.tok, acctBody('STRIPE')), [403, 404]);
refused(A, "School B's owner can't", await call('POST', `/schools/${SA.id}/payment-accounts`, PB.owner.tok, acctBody('STRIPE')), [403, 404]);
refused(A, "staff WITH the switch can't choose bank transfer (Decision 443 item 3)", await call('POST', `/schools/${SA.id}/payment-accounts`, P.staffStripe.tok, acctBody('BANK_TRANSFER')), [403]);
refused(A, "staff WITH the switch can't choose cash", await call('POST', `/schools/${SA.id}/payment-accounts`, P.staffStripe.tok, acctBody('CASH')), [400, 403]);
const made = await call('POST', `/schools/${SA.id}/payment-accounts`, P.staffStripe.tok, acctBody('STRIPE'));
rec(A, 'staff with the switch creates the Stripe account', made.status < 300 && made.body?.provider === 'STRIPE', `${made.status} ${made.body?.provider}`);
rec(A, 'what staff see in the create response', null, Object.keys(made.body ?? {}).join(','));
const acctId = made.body?.id;

// --- onboarding --------------------------------------------------------------------
refused(A, "staff without the switch can't start onboarding", await call('POST', `/payment-accounts/${acctId}/connect/onboard`, P.staff1.tok, {}), [403, 404]);
refused(A, "coach can't start onboarding", await call('POST', `/payment-accounts/${acctId}/connect/onboard`, P.coach.tok, {}), [403, 404]);
refused(A, "School B's owner can't onboard School A's account", await call('POST', `/payment-accounts/${acctId}/connect/onboard`, PB.owner.tok, {}), [403, 404]);
const fake = '00000000-0000-4000-8000-000000000000';
const rr = await call('POST', `/payment-accounts/${acctId}/connect/onboard`, PB.owner.tok, {});
const rf = await call('POST', `/payment-accounts/${fake}/connect/onboard`, PB.owner.tok, {});
rec(A, "another School's account id answers like a made-up one", rr.status === rf.status && rr.body?.error?.message === rf.body?.error?.message, `${rr.status}/${rf.status}`);
const ob = await call('POST', `/payment-accounts/${acctId}/connect/onboard`, P.staffStripe.tok, {});
rec(A, 'staff with the switch starts onboarding', ob.status < 300 && /connect\.stripe\.test/.test(ob.body?.onboardingUrl ?? ''), `${ob.status} ${ob.body?.onboardingUrl ?? JSON.stringify(ob.body).slice(0, 120)}`);
const pa = await db.paymentAccount.findUnique({ where: { id: acctId } });
// Pix account of B: A's staff can't onboard it.
const bAcct = await db.paymentAccount.findFirst({ where: { schoolId: SB.id } });
refused(A, "School A's switched-on staff can't onboard School B's account", await call('POST', `/payment-accounts/${bAcct.id}/connect/onboard`, P.staffStripe.tok, {}), [403, 404]);

// --- connect status ----------------------------------------------------------------
const st = await call('GET', `/schools/${SA.id}/payment-account/connect-status`, P.staffStripe.tok);
rec(A, 'switched-on staff read the connect status', st.status === 200, `${st.status} ${st.body?.status}`);
for (const [label, tok] of [['staff without the switch', P.staff1.tok], ['coach', P.coach.tok], ['member', P.adult1.tok], ["School B's owner", PB.owner.tok]]) {
  refused(A, `${label} can't read School A's connect status`, await call('GET', `/schools/${SA.id}/payment-account/connect-status`, tok));
}
// The status read saves what Stripe says when it changed, in the caller's own
// context. The fake can't set a boolean on an account, so the saved flag is set
// to true in the database and Stripe (the fake) says "not ready": the
// switched-on staff member's read must save false without an error.
await db.paymentAccount.update({ where: { id: acctId }, data: { stripeAccountReady: true } });
const st2 = await call('GET', `/schools/${SA.id}/payment-account/connect-status`, P.staffStripe.tok);
const pa2 = await db.paymentAccount.findUnique({ where: { id: acctId } });
rec(A, "staff's status read saves Stripe's answer (works in a staff member's context)", st2.status === 200 && st2.body?.status === 'ACTION_NEEDED' && pa2.stripeAccountReady === false, `${st2.status} ${st2.body?.status ?? st2.body?.error?.message} saved=${pa2.stripeAccountReady}`);
// The payment-account read: who sees the Stripe account id?
for (const [label, tok] of [['staff with the switch', P.staffStripe.tok], ['staff without', P.staff1.tok], ['coach', P.coach.tok], ['member', P.adult1.tok], ["School B's owner", PB.owner.tok]]) {
  const r = await call('GET', `/schools/${SA.id}/payment-account`, tok);
  rec(A, `GET payment-account as ${label}`, null, `${r.status} ${r.status < 300 ? 'keys: ' + Object.keys(r.body).join(',') + ' acct=' + (r.body.stripeConnectedAccountId ? 'shown' : 'none') : r.body?.error?.message}`);
}
// Turning the switch off takes it away at once.
await must('switch off', 'PUT', `/schools/${SA.id}/staff/${P.staffStripe.id}/access`, P.owner.tok, { ...(await accessOf(P.staffStripe.id)), connectStripe: false });
refused(A, 'switch turned off: the same staff member is refused at once', await call('GET', `/schools/${SA.id}/payment-account/connect-status`, P.staffStripe.tok), [403]);
refused(A, 'switch turned off: onboarding refused', await call('POST', `/payment-accounts/${acctId}/connect/onboard`, P.staffStripe.tok, {}), [403]);
// The franchise status is owner-only.
refused(A, "School A's staff can't read a Franchise's connect status by guessing", await call('GET', `/franchises/${fake}/payment-account/connect-status`, P.staffStripe.tok), [403, 404]);

// --- A Brazilian School: staff with the switch and no account yet ---------------
// Decision 443 item 3: choosing cash or bank transfer stays with the owners.
// Can a switched-on staff member decide it for them by creating a Stripe
// account first (a School has only one payment account)?
{
  const o = await signUp({ first: 'Bruno', last: 'Dono', country: 'BR', language: 'pt-BR', currency: 'BRL' });
  const s = await must('school C', 'POST', '/schools', o.tok, { name: `R6P School C ${Date.now()}`, timezone: 'America/Sao_Paulo', defaultCurrency: 'BRL', defaultLanguage: 'pt-BR', postalAddress: { line1: 'Rua X, 1', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' }, acceptAgreement: true });
  await signIn(o);
  const b = await must('branch', 'POST', `/schools/${s.id}/branches`, o.tok, { name: 'C1', postalAddress: { line1: 'Rua X, 1', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' } });
  const st = await signUp({ first: 'Sara', last: 'Staff', country: 'BR', language: 'pt-BR', currency: 'BRL' });
  await must('grant', 'POST', `/users/${st.id}/role-grants`, o.tok, { role: 'BRANCH_STAFF', schoolId: s.id, branchId: b.id });
  await signIn(st);
  const row = ((await must('staff', 'GET', `/schools/${s.id}/staff`, o.tok)).items ?? []).find((x) => x.userId === st.id);
  await must('switch', 'PUT', `/schools/${s.id}/staff/${st.id}/access`, o.tok, { ...(row?.access ?? {}), connectStripe: true });
  const c = await call('POST', `/schools/${s.id}/payment-accounts`, st.tok, { provider: 'STRIPE', accountTitle: 'Cartão', country: 'BR' });
  const ob2 = c.status < 300 ? await call('POST', `/payment-accounts/${c.body.id}/connect/onboard`, st.tok, {}) : null;
  const ownerPix = await call('POST', `/schools/${s.id}/payment-accounts`, o.tok, { provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' });
  rec(A, 'BR School: switched-on staff create a Stripe account the School can never onboard; owner then cannot choose Pix', !(c.status < 300 && ownerPix.status >= 400),
    `staff create STRIPE ${c.status} (connectAvailable=${c.body?.connectAvailable}); onboard ${ob2?.status} ${ob2?.body?.error?.code ?? ''}; owner Pix after: ${ownerPix.status} ${ownerPix.body?.error?.message ?? ''}`);
  w.schoolC = { id: s.id, owner: o, staff: st, branch: b.id };
}

saveResults('stripe');
await db.$disconnect();
