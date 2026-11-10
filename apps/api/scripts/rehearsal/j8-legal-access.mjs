// Journey 8 (launch rehearsal 2): what was built after rehearsal 1.
//  - Legal (Decision 444, 448 item 8): the sign-up "I agree", the legal pages,
//    what is recorded, and the first-sign-in "I agree" for people the School
//    creates (added manually, approved tablet sign-ups, imports) and for
//    accounts made before the tick existed.
//  - Waivers (Decision 441 item 5, 442 item 1): imported past attendance skips
//    the waiver rule; booking and desk check-in don't.
//  - Stripe readiness (Decision 442 item 2) and Pix only in Brazil (448 item 5).
//  - Profile edits need "Manage students" (448 item 11); symbol-only search
//    (448 item 13); the tablet's 18th-birthday rule (448 item 14).
import { call, must, journey, check, ok, step, signUp, signIn, db, days, phoneFor, RUN } from './lib.mjs';

const LEGAL = ['terms-and-conditions', 'privacy-statement', 'school-agreement', 'children-notice', 'cookie-notice'];
const tokenClaims = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url'));
/** The day in Pacific/Kiritimati (the earliest time zone), as YYYY-MM-DD. */
const kiritimatiDay = (offsetDays = 0) => new Date(Date.now() + 14 * 3600e3 + days(offsetDays)).toISOString().slice(0, 10);
const yearsBefore = (day, n) => `${Number(day.slice(0, 4)) - n}${day.slice(4)}`;

/** First sign-in with a temporary passcode: the forced passcode change, then
 * the token the app gets. Returns { tok, claims }. */
async function firstSignIn(email, temp, newPasscode = '615283') {
  const l = await call('POST', '/auth/login', null, { email, passcode: temp });
  if (!l.body?.passcodeChangeToken) return { login: l };
  const ch = await call('POST', '/auth/passcode-change/first-login', l.body.passcodeChangeToken, { newPasscode });
  return { login: l, change: ch, tok: ch.body?.accessToken, passcode: newPasscode, claims: ch.body?.accessToken ? tokenClaims(ch.body.accessToken) : null };
}

/** The "I agree" step: refused before, the tick recorded once, then free. */
async function agreeStep(label, person) {
  const blocked = await call('GET', '/memberships/me', person.tok);
  const me = await call('GET', '/users/me', person.tok);
  const noTick = await call('POST', '/auth/legal-acceptance', person.tok, { acceptTerms: false });
  const yes = await call('POST', '/auth/legal-acceptance', person.tok, { acceptTerms: true });
  const tok2 = yes.body?.accessToken;
  const after = tok2 ? await call('GET', '/memberships/me', tok2) : null;
  const rows = await db.legalAcceptance.findMany({ where: { userId: person.id } });
  ok(`${label}: until they tick "I agree", every call but their profile answers LEGAL_ACCEPTANCE_REQUIRED`, blocked.status === 403 && blocked.body?.error?.code === 'LEGAL_ACCEPTANCE_REQUIRED' && me.status === 200,
    `GET /memberships/me ${blocked.status} ${blocked.body?.error?.code}; GET /users/me ${me.status}`);
  ok(`${label}: the tick is required, then recorded (Terms + Privacy, at first sign-in) and the app carries on`, noTick.status === 400 && noTick.body?.error?.code === 'TERMS_NOT_ACCEPTED' && yes.status < 300 && after?.status === 200 && !tokenClaims(tok2).legalPending
    && rows.filter((r) => r.atFirstSignIn).map((r) => r.documentSlug).sort().join(',') === 'privacy-statement,terms-and-conditions',
    `no tick ${noTick.status} ${noTick.body?.error?.code}; tick ${yes.status}; then ${after?.status}; rows ${rows.map((r) => `${r.documentSlug}@${r.version}${r.atFirstSignIn ? ' (first sign-in)' : ''}`).join(', ')}`);
  person.tok = tok2;
  return person;
}

export async function j8LegalAccess(ctx) {
  for (const key of ['A', 'B']) {
    const s = ctx[key];
    if (!s?.school) continue;
    const c = s.cfg;
    const sid = s.school.id;
    const O = () => s.owner.tok;
    journey(key, '8', 'Legal: "I agree", the pages, first sign-in');

    // --- Sign-up needs the tick; no self sign-up under 18 (Decision 444 items 1, 6) ---
    const email = `no.tick.${key}.${RUN}@rehearsal.test`.toLowerCase();
    const base = { email, phone: phoneFor(c.country), firstName: 'Sem', surname: 'Marca', passcode: '482913', passcodeConfirm: '482913', dateOfBirth: '1990-01-01', language: c.language, currency: c.currency };
    const r1 = await call('POST', '/auth/register', null, base);
    const r2 = await call('POST', '/auth/register', null, { ...base, acceptTerms: true, dateOfBirth: yearsBefore(kiritimatiDay(1), 18) });
    ok('sign-up without ticking "I agree" is refused; under 18 is refused', r1.status === 400 && r1.body?.error?.code === 'TERMS_NOT_ACCEPTED' && r2.status === 403 && r2.body?.error?.code === 'REGISTER_UNDER_18',
      `no tick ${r1.status} ${r1.body?.error?.code}; 18 tomorrow (earliest time zone) ${r2.status} ${r2.body?.error?.code}`);
    const created = await db.user.count({ where: { email } });
    ok('…and no account is made', created === 0, `${created} accounts`);

    if (key === 'A') {
      // The legal pages are open to everyone (no sign-in).
      const pages = [];
      for (const slug of LEGAL) { const r = await call('GET', `/legal/${slug}`); pages.push(`${slug} ${r.status} v=${r.body?.version}`); }
      ok('the five legal pages are open without signing in, each with a version', pages.every((p) => / 200 v=\S+/.test(p) && !/v=undefined/.test(p)), pages.join('; '));
    }
    const ownRows = await db.legalAcceptance.findMany({ where: { userId: s.owner.id } });
    const vers = Object.fromEntries((await db.legalDocument.findMany({ where: { slug: { in: LEGAL } } })).map((d) => [d.slug, d.version]));
    const signUpRows = ownRows.filter((r) => !r.schoolId && !r.franchiseId);
    const agreement = ownRows.find((r) => r.documentSlug === 'school-agreement' && r.schoolId === sid);
    ok('the owner\'s sign-up and the School\'s Agreement are recorded at the versions the server publishes', signUpRows.length === 2 && signUpRows.every((r) => r.version === vers[r.documentSlug] && !r.atFirstSignIn) && agreement?.version === vers['school-agreement'],
      `${ownRows.map((r) => `${r.documentSlug}@${r.version}${r.schoolId ? ' (School)' : ''}`).join(', ')}`);

    // --- People the School creates tick "I agree" at their first sign-in (Decision 448 item 8) ---
    const [mf, ml] = key === 'B' ? ['Rafaela', 'Nunes'] : ['Holly', 'Ward'];
    const manual = await step('owner adds a member manually (temporary passcode)', () => must('add manually', 'POST', `/schools/${sid}/students/add-manually`, O(), {
      firstName: mf, surname: ml, email: `${mf}.${ml}.${RUN}@rehearsal.test`.toLowerCase(), dateOfBirth: '1991-05-05', branchId: s.branch.id,
    }));
    if (manual?.temporaryPasscode) {
      const f = await firstSignIn(manual.email, manual.temporaryPasscode);
      ok('the added member signs in, changes the temporary passcode, and their token asks for "I agree"', f.tok && f.claims?.legalPending === true, `login ${f.login.status}${f.change ? `; change ${f.change.status}` : ''}; legalPending ${f.claims?.legalPending}`);
      if (f.tok) { s.manual = await agreeStep('added manually', { id: manual.id, email: manual.email, passcode: f.passcode, tok: f.tok }); }
    }

    // An approved tablet sign-up, and the tablet's 18th-birthday rule (Decision 448 item 14).
    const sess = await call('POST', `/schools/${sid}/front-desk/sessions`, O(), { branchId: s.branch.id });
    const K = sess.body?.sessionToken;
    if (K) {
      const k18 = yearsBefore(kiritimatiDay(0), 18);
      const k17 = yearsBefore(kiritimatiDay(1), 18);
      const [tf, tl] = key === 'B' ? ['Igor', 'Batista'] : ['Leo', 'Price'];
      const kEmail = `${tf}.${tl}.${RUN}@rehearsal.test`.toLowerCase();
      const young = await call('POST', '/front-desk/kiosk/sign-ups', K, { kind: 'MEMBER', firstName: tf, surname: tl, dateOfBirth: k17, email: `young.${kEmail}` });
      const adult = await call('POST', '/front-desk/kiosk/sign-ups', K, { kind: 'MEMBER', firstName: tf, surname: tl, dateOfBirth: k18, email: kEmail });
      ok('tablet sign-up: 18 today in the earliest time zone is accepted; 18 tomorrow is not', adult.status < 300 && young.status === 400 && young.body?.error?.code === 'SIGN_UP_UNDER_18',
        `born ${k18}: ${adult.status}; born ${k17}: ${young.status} ${young.body?.error?.code}`);
      if (adult.status < 300) {
        const ap = await call('POST', `/schools/${sid}/sign-ups/${adult.body.id}/approve`, O(), { branchId: s.branch.id });
        const temp = ap.body?.temporaryPasscode;
        const f = temp ? await firstSignIn(kEmail, temp) : {};
        const uid = f.claims?.sub;
        ok('an approved tablet sign-up gets an account; at first sign-in it asks for "I agree"', ap.status < 300 && f.claims?.legalPending === true, `approve ${ap.status} accountCreated ${ap.body?.accountCreated}; legalPending ${f.claims?.legalPending}`);
        if (f.tok) await agreeStep('approved tablet sign-up', { id: uid, email: kEmail, passcode: f.passcode, tok: f.tok });
      }
      await call('POST', `/schools/${sid}/front-desk/sessions/${sess.body.sessionId}/end`, O(), {});
    } else {
      check('tablet sign-up checks', 'BLOCKED', `front-desk session ${sess.status} ${sess.body?.error?.message ?? ''}`);
    }

    // An account made before the tick existed: no acceptance of its own.
    const old = await step('an account from before the "I agree" tick', async () => {
      const p = await signUp({ first: key === 'B' ? 'Vera' : 'Ruth', last: key === 'B' ? 'Antiga' : 'Older', dob: '1970-03-03', country: c.country, language: c.language, currency: c.currency });
      // Stand-in for "signed up before Decision 444": their rows are removed.
      await db.legalAcceptance.deleteMany({ where: { userId: p.id } });
      await signIn(p);
      return p;
    });
    if (old) {
      ok('an older account signing in is asked for "I agree" too', tokenClaims(old.tok).legalPending === true, `legalPending ${tokenClaims(old.tok).legalPending}`);
      await agreeStep('older account', old);
    }

    // --- Waivers and imports (Decision 442 item 1) ---
    journey(key, '8', 'Waivers: imported attendance, booking and desk check-in');
    // A class that started on a whole minute a few minutes ago (a class can't
    // be added once it has ended), so the import's date and time match it.
    const at = new Date(Math.floor((Date.now() - 5 * 60e3) / 60e3) * 60e3);
    const pastTitle = key === 'B' ? 'Aula importada' : 'Imported class';
    const past = await call('POST', `/schools/${sid}/classes`, O(), { branchId: s.branch.id, instructorId: s.owner.id, title: pastTitle, styles: s.styles, startDate: at.toISOString(), endDate: new Date(at.getTime() + 3600e3).toISOString(), membershipInclusion: true, capacity: 20 });
    const [imF, imL] = key === 'B' ? ['Otávio', 'Prado'] : ['Isla', 'Moore'];
    const imEmail = `${imF}.${imL}.${RUN}@rehearsal.test`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: c.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at).reduce((o, p) => ((o[p.type] = p.value), o), {});
    const runImport = async (kind, values) => {
      const st = await call('POST', `/schools/${sid}/imports`, O(), { kind, totalRows: 1, fileName: `${kind.toLowerCase()}.csv` });
      if (st.status >= 300) return st;
      return call('POST', `/schools/${sid}/imports/${st.body.id}/rows`, O(), { rows: [{ rowNumber: 2, values }] });
    };
    const mem = await runImport('MEMBERS', { first_name: imF, last_name: imL, email: imEmail, date_of_birth: '1993-07-07', branch: s.branch.name });
    const memOut = mem.body?.results?.[0] ?? mem.body?.rows?.[0];
    const imported = await db.user.findFirst({ where: { email: imEmail } });
    ok('a member is imported (an account the School creates)', !!imported, `${mem.status} ${memOut?.outcome ?? ''} ${memOut?.code ?? ''} ${memOut?.message ?? mem.body?.error?.message ?? ''}`);
    if (imported && past.status < 300) {
      const att = await runImport('ATTENDANCE', { email: imEmail, first_name: imF, last_name: imL, date: `${local.year}-${local.month}-${local.day}`, time: `${local.hour === '24' ? '00' : local.hour}:${local.minute}`, class: pastTitle });
      const out = att.body?.results?.[0] ?? att.body?.rows?.[0];
      const b = await db.booking.findFirst({ where: { classId: past.body.id, studentId: imported.id } });
      const signed = await db.waiverSignature.count({ where: { studentId: imported.id, status: 'SIGNED' } });
      ok('their past attendance imports although they never signed the waiver', b?.status === 'COMPLETED' && signed === 0, `${att.status} ${out?.outcome ?? ''} ${out?.code ?? ''} ${out?.message ?? att.body?.error?.message ?? ''}; booking ${b?.status}; waivers signed ${signed}`);
      // Staff check them in at the desk to today's class: refused for the waiver.
      const desk = await call('POST', `/schools/${sid}/front-desk/check-ins`, O(), { studentId: imported.id, classIds: [s.nowClass.id] });
      const refusal = desk.body?.classes?.[0];
      ok('but a check-in at the desk today is refused until the waiver is signed', refusal?.ok === false && /WAIVER_REQUIRED/.test(refusal?.code ?? ''), `${desk.status} ${JSON.stringify(refusal ?? desk.body).slice(0, 220)}`);
      s.imported = { id: imported.id, email: imEmail };
    } else if (past.status >= 300) {
      check('a class in the past for the import', 'BLOCKED', `${past.status} ${past.body?.error?.message}`);
    }

    // --- Profile edits need "Manage students" (Decision 448 item 11) ---
    journey(key, '8', 'Access: profile edits, payment account, search');
    if (s.staff && s.adult && s.coach) {
      const target = s.manual?.id ?? s.adult.id;
      const list = ((await must('staff list', 'GET', `/schools/${sid}/staff`, O())).items ?? []).find((x) => x.userId === s.staff.id);
      const edit = (tok) => call('PATCH', `/schools/${sid}/students/${target}/profile`, tok, { emergencyContactName: 'Rehearsal' });
      const on = await edit(s.staff.tok);
      await must('students off', 'PUT', `/schools/${sid}/staff/${s.staff.id}/access`, O(), { ...(list?.access ?? {}), students: false });
      const off = await edit(s.staff.tok);
      await must('students back', 'PUT', `/schools/${sid}/staff/${s.staff.id}/access`, O(), { ...(list?.access ?? {}), students: true });
      const coach = await edit(s.coach.tok);
      const owner = await edit(O());
      ok('editing a member\'s profile: owners and Branch Staff with "Manage students"; not staff without it, nor a coach', owner.status === 200 && on.status === 200 && off.status === 403 && coach.status === 403 && coach.body?.error?.code === 'NOT_FOR_COACHES',
        `owner ${owner.status}; staff with it ${on.status} ${on.body?.error?.message ?? ''}; staff without ${off.status} ${off.body?.error?.code}; coach ${coach.status} ${coach.body?.error?.code}`);
      const memberPa = await call('GET', `/schools/${sid}/payment-account`, s.adult.tok);
      ok('a member can\'t read the School\'s payment account', memberPa.status >= 400 && memberPa.status < 500 && !JSON.stringify(memberPa.body).includes('acct_'), `${memberPa.status} ${memberPa.body?.error?.code ?? ''}`);
    }

    // --- Symbol-only search shows nobody (Decision 448 item 13) ---
    const q = async (term) => call('GET', `/schools/${sid}/students?search=${encodeURIComponent(term)}`, O());
    const [pct, und, name] = await Promise.all([q('%'), q('_'), q(c.names.adult[0])]);
    const n = (r) => (r.body?.items ?? r.body ?? []).length;
    ok('searching students for "%" or "_" finds nobody; a name still finds them', pct.status === 200 && und.status === 200 && n(pct) === 0 && n(und) === 0 && n(name) > 0, `"%" ${n(pct)}, "_" ${n(und)}, "${c.names.adult[0]}" ${n(name)}`);

    // --- Pix only in Brazil (Decision 448 item 5) ---
    journey(key, '8', 'Pix only in Brazil');
    if (s.lonely?.id || s.extra?.id) {
      const who = s.extra?.id ?? s.lonely.id;
      const pix = await call('POST', `/schools/${sid}/students/${who}/memberships/sell`, O(), { membershipPlanId: s.plans.kids.id, paymentMethod: 'PIX' });
      if (c.country === 'BR') {
        ok('a Brazilian School can record a desk sale paid by Pix', pix.status < 300, `${pix.status} ${pix.body?.error?.message ?? ''}`);
      } else {
        const due = new Date(Date.now() + days(7)).toISOString().slice(0, 10);
        const charge = await call('POST', `/schools/${sid}/students/${who}/charges`, O(), { description: 'Gi', amount: 3000, dueDate: due });
        const pay = charge.status < 300 ? await call('POST', `/schools/${sid}/students/${who}/charge-payments`, O(), { chargeId: charge.body.id, amount: 3000, paymentMethod: 'PIX' }) : null;
        ok('a UK School can\'t record Pix (desk sale or a payment toward a charge)', pix.status === 400 && /Pix/.test(pix.body?.error?.message ?? '') && pay?.status === 400,
          `desk sale ${pix.status} "${pix.body?.error?.message}"; charge payment ${pay?.status} ${pay?.body?.error?.message ?? ''}`);
        if (charge.status < 300) await call('POST', `/schools/${sid}/charges/${charge.body.id}/cancel`, O(), { reason: 'Rehearsal' });
      }
    }
  }

  // --- A UK School whose Stripe onboarding isn't finished (Decision 442 item 2) ---
  const A = ctx.A;
  if (!A?.cfg) return;
  journey('A', '8', 'Stripe not ready yet: no card payments');
  await step('a second UK School, Stripe onboarding started but not finished', async () => {
    const c = A.cfg;
    const o = await signUp({ first: 'Harriet', last: 'Pending', dob: '1983-03-03', country: 'GB', language: 'en-GB', currency: 'GBP' });
    const sc = await must('school', 'POST', '/schools', o.tok, { name: 'Rehearsal Dojo Leeds', timezone: c.timezone, defaultCurrency: 'GBP', defaultLanguage: 'en-GB', postalAddress: { line1: '1 Park Row', city: 'Leeds', postalCode: 'LS1 5AB', country: 'GB' }, acceptAgreement: true });
    await signIn(o);
    const br = await must('branch', 'POST', `/schools/${sc.id}/branches`, o.tok, { name: 'Centre', postalAddress: { line1: '1 Park Row', city: 'Leeds', postalCode: 'LS1 5AB', country: 'GB' } });
    const acct = await must('stripe acct', 'POST', `/schools/${sc.id}/payment-accounts`, o.tok, { provider: 'STRIPE', accountTitle: 'Main', country: 'GB' });
    await must('onboard', 'POST', `/payment-accounts/${acct.id}/connect/onboard`, o.tok, {});
    const plan = await must('plan', 'POST', `/schools/${sc.id}/membership-plans`, o.tok, { currency: 'GBP', type: 'CLASS_PACK', title: '4-class pack', price: 4000, classesIncluded: 4, expiryDurationDays: 60 });
    const next = await must('plan2', 'POST', `/schools/${sc.id}/membership-plans`, o.tok, { currency: 'GBP', type: 'CLASS_PACK', title: '8-class pack', price: 7000, classesIncluded: 8, expiryDurationDays: 60 });
    const sw = await call('POST', `/schools/${sc.id}/membership-plans`, o.tok, { currency: 'GBP', type: 'WEEKLY_PASS', title: 'Trial week', price: 1000, expiryDurationDays: 7, switchToPlanId: next.id });
    const m = await signUp({ first: 'Freya', last: 'Pending', dob: '1994-04-04', country: 'GB', language: 'en-GB', currency: 'GBP' });
    await must('join', 'POST', `/schools/${sc.id}/join`, m.tok, { branchId: br.id });
    await signIn(m);
    const card = await call('POST', `/membership-plans/${plan.id}/purchase`, m.tok, { useHostedCheckout: true });
    const order = await call('POST', `/membership-plans/${plan.id}/purchase`, m.tok, {});
    const tx = order.status < 300 ? await db.transaction.findUnique({ where: { id: order.body.transactionId } }) : null;
    const cp = await call('GET', `/schools/${sc.id}/card-payments`, m.tok);
    ok('a card purchase is refused with CARD_PAYMENTS_NOT_READY until Stripe says the account is ready', card.status === 400 && card.body?.error?.code === 'CARD_PAYMENTS_NOT_READY', `${card.status} ${card.body?.error?.code}`);
    ok('meanwhile members order and pay at the School, with no card surcharge, and never as Pix', order.status < 300 && tx?.status === 'PENDING' && (tx?.surchargeAmount ?? 0) === 0 && tx?.paymentMethod !== 'PIX', `${order.status} ${order.body?.outcome}; ${tx?.status} ${tx?.paymentMethod}, surcharge ${tx?.surchargeAmount}; card-payments ${JSON.stringify(cp.body).slice(0, 160)}`);
    check('"switch to another plan" before Stripe is ready', sw.status === 400 && sw.body?.error?.code === 'SWITCH_NEEDS_CARDS' ? 'NOTE' : 'PASS',
      `${sw.status} ${sw.body?.error?.code ?? ''}: a UK School that hasn't finished Stripe onboarding can't set "switch to" on a plan yet (it works as a School without cards, Decision 442 item 2). Owners need to finish Stripe first.`);
    const blocked = await call('GET', `/schools/${sc.id}/payment-account`, m.tok);
    ok('the member can\'t read this School\'s payment account either', blocked.status >= 400 && blocked.status < 500, `${blocked.status}`);
    A.notReady = { owner: o, school: sc };
    return true;
  });
}
