// Journey 1: the owner signs up and sets the School up.
import { call, must, journey, check, ok, step, signUp, signIn, db, days } from './lib.mjs';

const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const stepKeys = (d) => d?.setupChecklist?.steps?.map((x) => x.key) ?? [];
const stepDone = (d, key) => d?.setupChecklist?.steps?.find((x) => x.key === key)?.done;

export async function j1Setup(s) {
  const c = s.cfg;
  journey(c.key, '1', 'Owner sign-up and School setup');
  const [of, ol] = c.names.owner;

  s.owner = await step('owner signs up (register, SMS code, sign in)', () => signUp({ first: of, last: ol, dob: '1982-06-15', country: c.country, language: c.language, currency: c.currency }));
  if (!s.owner) return;
  check('owner signs up (register, SMS code, sign in)', 'PASS', s.owner.email);

  s.school = await step('owner creates the School', () => must('school', 'POST', '/schools', s.owner.tok, {
    name: c.name, timezone: c.timezone, defaultCurrency: c.currency, defaultLanguage: c.language, postalAddress: c.address, ranksToggle: true,
  }));
  if (!s.school) return;
  ok('owner creates the School', s.school.addressCountry === c.country && s.school.defaultCurrency === c.currency && s.school.timezone === c.timezone,
    `${s.school.name}: ${s.school.addressCountry}, ${s.school.defaultCurrency}, ${s.school.timezone}, ${s.school.defaultLanguage}`);
  await signIn(s.owner); // the new owner role is in the next token
  const sid = s.school.id;
  const T = () => s.owner.tok;

  // The Dashboard checklist before anything is set up.
  const dash0 = (await call('GET', `/schools/${sid}/dashboard`, T())).body;
  if (c.cards) {
    ok('Dashboard checklist includes "Connect Stripe"', dash0?.setupChecklist?.stripeConnectAvailable === true && stepKeys(dash0).includes('STRIPE'), stepKeys(dash0).join(','));
  } else {
    ok('Dashboard checklist drops "Connect Stripe" (no card payments in Brazil)', dash0?.setupChecklist?.stripeConnectAvailable === false && !stepKeys(dash0).includes('STRIPE'), `stripeConnectAvailable=${dash0?.setupChecklist?.stripeConnectAvailable}; steps ${stepKeys(dash0).join(',')}`);
  }

  // Branch, style, coach, timetable and classes.
  s.branch = await step('add a Branch', () => must('branch', 'POST', `/schools/${sid}/branches`, T(), { name: c.branch, postalAddress: c.address }));
  if (!s.branch) return;
  check('add a Branch', 'PASS', s.branch.name);
  const style = await step('add a style with belts (BJJ from the IBJJF template)', () => must('style', 'POST', `/schools/${sid}/disciplines/from-template`, T(), { templateId: 'ibjjf', name: 'BJJ' }));
  if (!style) return;
  s.discipline = style;
  const discipline = await db.discipline.findUnique({ where: { id: style.id } });
  s.styles = [{ disciplineId: style.id, classType: (discipline.classTypesOffered || [])[0] ?? null }];
  check('add a style with belts (BJJ from the IBJJF template)', 'PASS', `${style.name}: ${(await db.rank.count({ where: { disciplineId: style.id } }))} belts`);

  // As the portal does it: the Instructor role first, then the coach profile.
  const coach = await step('owner also coaches at the Branch', async () => (await must('instructor role', 'POST', `/users/${s.owner.id}/role-grants`, T(), { role: 'INSTRUCTOR', schoolId: sid, branchId: s.branch.id })) && (await signIn(s.owner)) && must('instructor', 'POST', `/schools/${sid}/instructors`, T(), { userId: s.owner.id, branchId: s.branch.id, specializationStyleIds: [style.id] }));
  if (coach) check('owner also coaches at the Branch', 'PASS', `instructor ${coach.id}`);
  await signIn(s.owner);

  const slot = await step('add a weekly timetable slot', () => must('slot', 'POST', `/schools/${sid}/timetable`, T(), {
    branchId: s.branch.id, instructorId: s.owner.id, weekday: 'TUESDAY', startTime: '18:30', endTime: '20:00', title: c.key === 'B' ? 'BJJ Todos os níveis' : 'BJJ All levels', styles: s.styles, capacity: 20,
  }));
  if (slot) check('add a weekly timetable slot', 'PASS', `${slot.weekday} ${slot.startTime}-${slot.endTime}`);
  const gen = await step('make the weeks\' classes from the timetable', async () => {
    const { runJob } = await import('./lib.mjs');
    await runJob('class-occurrence-generation');
    return db.class.count({ where: { schoolId: sid, timetableSlotId: slot?.id } });
  });
  if (gen !== undefined) ok('make the weeks\' classes from the timetable', gen > 0, `${gen} classes made for the slot`);

  const mkClass = (title, startOff, endOff, extra = {}) => must(`class ${title}`, 'POST', `/schools/${sid}/classes`, T(), {
    branchId: s.branch.id, instructorId: s.owner.id, title, styles: s.styles, startDate: at(startOff), endDate: at(endOff), membershipInclusion: true, ...extra,
  });
  // A small class tomorrow (for the waitlist) and one starting now (for check-in).
  s.smallClass = await step('add a one-off class with 1 place (tomorrow)', () => mkClass(c.key === 'B' ? 'Turma pequena' : 'Small group', days(1), days(1) + 3600e3, { capacity: 1 }));
  s.nowClass = await step('add a class starting now', () => mkClass(c.key === 'B' ? 'Treino livre agora' : 'Open mat now', -10 * 60e3, 50 * 60e3, { capacity: 20 }));
  if (s.smallClass && s.nowClass) check('add one-off classes (1 place tomorrow; one now)', 'PASS', `${s.smallClass.id}, ${s.nowClass.id}`);

  // Plans: a joining fee and a member limit; a plan that switches to another.
  const fees = await step('switch joining fees on', () => must('joining fees', 'PATCH', `/schools/${sid}`, T(), { joiningFeesEnabled: true }));
  if (fees) ok('switch joining fees on', fees.joiningFeesEnabled === true, `joiningFeesEnabled=${fees.joiningFeesEnabled}`);
  const plan = (body) => must(`plan ${body.title}`, 'POST', `/schools/${sid}/membership-plans`, T(), { currency: c.currency, ...body });
  s.plans = {};
  s.plans.pack = await step('plan with a joining fee and a member limit', () => plan({ type: 'CLASS_PACK', title: c.plans.pack, price: 8000, classesIncluded: 10, expiryDurationDays: 90, joiningFee: 2500, joiningFeeRefundable: false, memberLimit: 2 }));
  if (s.plans.pack) ok('plan with a joining fee and a member limit', s.plans.pack.joiningFee === 2500 && s.plans.pack.memberLimit === 2, `joiningFee ${s.plans.pack.joiningFee}, memberLimit ${s.plans.pack.memberLimit}`);
  s.plans.next = await step('the plan to switch into', () => plan({ type: 'CLASS_PACK', title: c.plans.next, price: 4500, classesIncluded: 5, expiryDurationDays: 60 }));
  s.plans.week = await step('plan that switches to another when it ends', () => plan({ type: 'WEEKLY_PASS', title: c.plans.week, price: 1500, expiryDurationDays: 7, switchToPlanId: s.plans.next?.id }));
  if (s.plans.week) ok('plan that switches to another when it ends', s.plans.week.switchToPlanId === s.plans.next?.id, `${c.plans.week} → ${s.plans.next?.title}`);
  s.plans.kids = await step('a plan for the children', () => plan({ type: 'CLASS_PACK', title: c.plans.kids, price: 5000, classesIncluded: 8, expiryDurationDays: 60 }));
  // A monthly Subscription. At a School without card payments nobody can sell
  // one (in the app or at the desk); journey 3 shows what a member sees.
  const sub = await call('POST', `/schools/${sid}/membership-plans`, T(), { currency: c.currency, type: 'SUBSCRIPTION', title: c.plans.sub, price: c.cards ? 6500 : 18000 });
  if (c.cards) {
    ok('a monthly Subscription', sub.status < 300, `${sub.status} ${sub.body?.price} ${sub.body?.currency}`);
    s.plans.sub = sub.body;
  } else {
    check('a monthly Subscription at a School without card payments', 'NOTE', `created: ${sub.status} (allowed, though it can never be sold here; see journey 3)`);
    s.plans.subNoCards = sub.status < 300 ? sub.body : null;
  }

  s.waiver = await step('add a waiver', () => must('waiver', 'POST', `/schools/${sid}/waivers`, T(), {
    title: c.key === 'B' ? 'Termo de responsabilidade' : 'Liability waiver',
    body: c.key === 'B' ? 'Declaro estar ciente dos riscos da prática de artes marciais.' : 'I understand that martial arts training carries a risk of injury.',
  }));
  if (s.waiver) check('add a waiver', 'PASS', s.waiver.title);

  // Payments.
  if (c.cards) {
    // Decision 406: the surcharge country list is Platform Admin's; Platform
    // Admin signs in through Cognito, so the rehearsal adds GB to it directly.
    await db.cardSurchargeCountry.upsert({ where: { countryCode: 'GB' }, create: { countryCode: 'GB' }, update: {} });
    const sur = await step('turn on a 2% card surcharge', () => must('surcharge', 'PUT', `/schools/${sid}/card-surcharge`, T(), { enabled: true, bps: 200, legalConfirmed: true }));
    if (sur) ok('turn on a 2% card surcharge', sur.enabled === true && sur.bps === 200, JSON.stringify(sur));
    s.payAcct = await step('add a Stripe payment account', () => must('payment account', 'POST', `/schools/${sid}/payment-accounts`, T(), { provider: 'STRIPE', accountTitle: 'Main', country: 'GB' }));
    if (s.payAcct) ok('add a Stripe payment account', s.payAcct.connectAvailable === true, `provider ${s.payAcct.provider}, connectAvailable ${s.payAcct.connectAvailable}`);
    const ob = await step('Connect Stripe: get the onboarding link (fake Stripe)', () => must('onboard', 'POST', `/payment-accounts/${s.payAcct.id}/connect/onboard`, T(), {}));
    if (ob) ok('Connect Stripe: get the onboarding link (fake Stripe)', /^https:\/\/connect\.stripe\.test\//.test(ob.onboardingUrl ?? ''), ob.onboardingUrl);
    s.acct = (await db.paymentAccount.findUnique({ where: { id: s.payAcct?.id ?? '' } }))?.stripeConnectedAccountId;
    check('School Portal has a Connect Stripe screen for a School', 'NOTE', 'No: the checklist says ULTM8 support connects Stripe ("Stripe has no portal screen yet", SetupChecklist.tsx). Rehearsed through the API, as the owner.');
  } else {
    s.payAcct = await step('add a bank transfer (Pix) payment account', () => must('payment account', 'POST', `/schools/${sid}/payment-accounts`, T(), { provider: c.provider, accountTitle: 'Pix', country: 'BR' }));
    if (s.payAcct) ok('add a bank transfer (Pix) payment account', s.payAcct.provider === 'BANK_TRANSFER' && s.payAcct.connectAvailable === false, `provider ${s.payAcct.provider}, connectAvailable ${s.payAcct.connectAvailable}`);
    // A second Brazilian School, set up for the refusal only: a School has one
    // payment account, and the portal never creates a Stripe one there.
    await step('Connect Stripe refused in Brazil, with a translated reason', async () => {
      const o2 = await signUp({ first: 'Rafael', last: 'Teste', country: 'BR', language: 'pt-BR', currency: 'BRL' });
      const s2 = await must('school2', 'POST', '/schools', o2.tok, { name: 'Academia Recusa Connect', timezone: c.timezone, defaultCurrency: 'BRL', defaultLanguage: 'pt-BR', postalAddress: c.address });
      await signIn(o2);
      const acct = await must('stripe acct BR', 'POST', `/schools/${s2.id}/payment-accounts`, o2.tok, { provider: 'STRIPE', accountTitle: 'Cartão', country: 'BR' });
      const callsUrl = `http://localhost:${process.env.FAKE_STRIPE_PORT || 12111}/__calls`;
      const before = (await (await fetch(callsUrl)).json())['POST /v1/accounts'] ?? 0;
      const r = await call('POST', `/payment-accounts/${acct.id}/connect/onboard`, o2.tok, {});
      const after = (await (await fetch(callsUrl)).json())['POST /v1/accounts'] ?? 0;
      const msg = r.body?.error?.message ?? '';
      const pt = (await serverText('pt-BR'))[msg] ?? null;
      ok('Connect Stripe refused in Brazil, with a translated reason', r.status === 400 && acct.connectAvailable === false && pt && pt !== msg && !/Stripe aren't/.test(pt),
        `onboard ${r.status}; connectAvailable ${acct.connectAvailable}; en "${msg}"; pt-BR "${pt}"`);
      ok('no Stripe connected account is created for the refused Brazilian School', after === before, `Stripe accounts.create calls: ${before} before, ${after} after`);
      s.connectProbe = { owner: o2, school: s2 };
    });
  }

  // The checklist afterwards.
  const dash = (await call('GET', `/schools/${sid}/dashboard`, T())).body;
  const want = ['BRANCH', 'STYLE_AND_BELTS', 'CLASS', 'MEMBERSHIP_PLAN', 'WAIVER'];
  ok('Dashboard checklist ticks each step as it is done', want.every((k) => stepDone(dash, k) === true), JSON.stringify(dash?.setupChecklist?.steps));
  if (c.cards) check('Dashboard "Connect Stripe" step after onboarding started', stepDone(dash, 'STRIPE') ? 'PASS' : 'NOTE', `STRIPE done=${stepDone(dash, 'STRIPE')} (onboarding with Stripe itself is not finished in the fake)`);
}

/** The apps' table of API error messages for one language (packages/i18n,
 *  Decisions 273/323): the portal and the member app show the API's English
 *  message through it. Node loads the .ts file directly (type stripping). */
export async function serverText(lang) {
  const m = await import(new URL(`../../../../packages/i18n/src/server/${lang}.ts`, import.meta.url));
  return m.serverMessages;
}
