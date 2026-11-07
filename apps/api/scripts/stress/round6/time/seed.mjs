// Round 6 T: seed ~20 Schools across six countries through the real API.
//   node seed.mjs            (N_MEMBERS per School, default 50; SCHOOLS=0,1,2 to seed some)
// Resumable: Schools already in out/cast.json are skipped.
//
// Through the API, as each person: owner sign-up (with the Decision 444 ticks),
// School + Branch, payment account, plans, waiver, a members import (MEMBERS
// kind) and a desk sale of the monthly plan to every imported member at a
// School without cards (Decision 441 item 1: billed to the balance).
// Shortcuts, each named:
//   - platformSubscriptionStatus = ACTIVE on each School (Platform Admin's
//     billing, Cognito sign-in), so runs dated months ahead aren't skipped as
//     "trial ended".
//   - Stripe onboarding is finished on the fake (details_submitted) and the
//     signed account.updated webhook is sent, as Stripe would.
import { call, must, db, signUp, signIn, pool, loadCast, saveCast, FAKE, stripeWebhook, sleep } from './lib.mjs';

const N_MEMBERS = Number(process.env.N_MEMBERS || 50);
const C = {
  GB: { tz: 'Europe/London', cur: 'GBP', lang: 'en-GB', addr: { line1: '1 High St', city: 'London', postalCode: 'E1 6AN', country: 'GB' }, price: 6500 },
  DE: { tz: 'Europe/Berlin', cur: 'EUR', lang: 'de-DE', addr: { line1: 'Hauptstr. 1', city: 'Berlin', postalCode: '10115', country: 'DE' }, price: 7000 },
  BR: { tz: 'America/Sao_Paulo', cur: 'BRL', lang: 'pt-BR', addr: { line1: 'Rua Augusta, 1500', city: 'São Paulo', region: 'SP', postalCode: '01304-001', country: 'BR' }, price: 18000 },
  JP: { tz: 'Asia/Tokyo', cur: 'JPY', lang: 'ja-JP', addr: { line1: '1-1 Shibuya', city: 'Tokyo', postalCode: '150-0002', country: 'JP' }, price: 1200000 },
  US: { tz: 'America/New_York', cur: 'USD', lang: 'en-US', addr: { line1: '1 Main St', city: 'New York', region: 'NY', postalCode: '10001', country: 'US' }, price: 15000 },
  USW: { tz: 'America/Los_Angeles', cur: 'USD', lang: 'en-US', addr: { line1: '1 Sunset Blvd', city: 'Los Angeles', region: 'CA', postalCode: '90028', country: 'US' }, price: 15000 },
  AU: { tz: 'Australia/Sydney', cur: 'AUD', lang: 'en-AU', addr: { line1: '1 George St', city: 'Sydney', region: 'NSW', postalCode: '2000', country: 'AU' }, price: 16000 },
  AUW: { tz: 'Australia/Perth', cur: 'AUD', lang: 'en-AU', addr: { line1: '1 Hay St', city: 'Perth', region: 'WA', postalCode: '6000', country: 'AU' }, price: 16000 },
};
// [country key, provider]: STRIPE Schools take cards once onboarding is done.
export const PLAN = [
  ['GB', 'STRIPE'], ['GB', 'STRIPE'], ['GB', 'CASH'], ['GB', 'BANK_TRANSFER'],
  ['DE', 'STRIPE'], ['DE', 'BANK_TRANSFER'], ['DE', 'CASH'],
  ['BR', 'BANK_TRANSFER'], ['BR', 'BANK_TRANSFER'], ['BR', 'CASH'], ['BR', 'BANK_TRANSFER'],
  ['JP', 'CASH'], ['JP', 'CASH'], ['JP', 'BANK_TRANSFER'],
  ['US', 'CASH'], ['US', 'BANK_TRANSFER'], ['USW', 'CASH'],
  ['AU', 'CASH'], ['AU', 'BANK_TRANSFER'], ['AUW', 'CASH'],
];

const only = process.env.SCHOOLS ? process.env.SCHOOLS.split(',').map(Number) : PLAN.map((_, i) => i);
const cast = loadCast();
const RUN = process.env.RUN_TAG || 't6';

export async function seedSchool(i, { members = N_MEMBERS, tag = RUN } = {}) {
  const [ck, provider] = PLAN[i];
  const c = C[ck];
  const t0 = Date.now();
  const owner = await signUp({ first: `Owner${i}`, last: ck, dob: '1980-03-03', language: c.lang, currency: c.cur, tag: `${tag}s${i}` });
  const school = await must('school', 'POST', '/schools', owner.tok, {
    name: `R6T ${ck} ${i} ${provider}`, timezone: c.tz, defaultCurrency: c.cur, defaultLanguage: c.lang, postalAddress: c.addr, ranksToggle: true, acceptAgreement: true,
  });
  await signIn(owner);
  const sid = school.id;
  const T = owner.tok;
  await db.school.update({ where: { id: sid }, data: { platformSubscriptionStatus: 'ACTIVE' } }); // shortcut (Platform Admin billing)
  const branch = await must('branch', 'POST', `/schools/${sid}/branches`, T, { name: `Main ${i}`, postalAddress: c.addr });
  const country = c.addr.country;
  const acct = await must('payment account', 'POST', `/schools/${sid}/payment-accounts`, T, { provider, accountTitle: provider, country });
  let stripeAcct = null;
  if (provider === 'STRIPE') {
    await must('onboard', 'POST', `/payment-accounts/${acct.id}/connect/onboard`, T, {});
    stripeAcct = (await db.paymentAccount.findUnique({ where: { id: acct.id } })).stripeConnectedAccountId;
    await fetch(`${FAKE}/__accounts/${stripeAcct}`, { method: 'POST', body: JSON.stringify({ details_submitted: true, charges_enabled: true }) });
    const wh = await stripeWebhook({ id: `evt_acct_${stripeAcct}_ready`, object: 'event', type: 'account.updated', account: stripeAcct, data: { object: { id: stripeAcct, object: 'account' } } });
    for (let k = 0; k < 40; k++) { if ((await db.paymentAccount.findUnique({ where: { id: acct.id } })).stripeAccountReady) break; await sleep(250); }
  }
  const plan = (body) => must(`plan ${body.title}`, 'POST', `/schools/${sid}/membership-plans`, T, { currency: c.cur, ...body });
  const plans = {
    sub: await plan({ type: 'SUBSCRIPTION', title: 'Monthly unlimited', price: c.price }),
    pack: await plan({ type: 'CLASS_PACK', title: '10-class pack', price: Math.round(c.price * 0.8), classesIncluded: 10, expiryDurationDays: 90 }),
    week: await plan({ type: 'WEEKLY_PASS', title: 'Week pass', price: Math.round(c.price * 0.25), expiryDurationDays: 7 }),
  };
  const waiver = await must('waiver', 'POST', `/schools/${sid}/waivers`, T, { title: 'Liability waiver', body: 'I understand that martial arts training carries a risk of injury.' });

  // Members: one MEMBERS import, in batches the API allows.
  const lim = await must('limits', 'GET', `/schools/${sid}/imports/limits`, T);
  const rows = Array.from({ length: members }, (_, k) => ({
    rowNumber: k + 2,
    values: { first_name: `M${k}`, last_name: `${ck}${i}`, email: `m${k}.${ck.toLowerCase()}${i}.${tag}@round6t.test`, phone: '', date_of_birth: '1990-0' + (1 + (k % 9)) + '-15', gender: '', join_date: '', belts: '', branch: branch.name, guardian_email: '', guardian_first_name: '', guardian_last_name: '' },
  }));
  const imp = await must('import start', 'POST', `/schools/${sid}/imports`, T, { kind: 'MEMBERS', totalRows: rows.length, fileName: 'members.csv' });
  const per = lim.maxRowsPerRequest || 100;
  let okRows = 0;
  for (let k = 0; k < rows.length; k += per) {
    const r = await must('import rows', 'POST', `/schools/${sid}/imports/${imp.id}/rows`, T, { rows: rows.slice(k, k + per) });
    okRows += r.rows.filter((x) => x.outcome === 'CREATED').length;
    if (k === 0 && okRows === 0) console.log('import row sample', JSON.stringify(r.rows[0]));
  }
  const users = await db.user.findMany({ where: { email: { in: rows.map((r) => r.values.email) } }, select: { id: true, email: true } });
  // Desk sale of the monthly plan at a School without cards; a pack at a card School.
  const sold = await pool(users, 6, async (u) => {
    const planId = provider === 'STRIPE' ? plans.pack.id : plans.sub.id;
    const r = await call('POST', `/schools/${sid}/students/${u.id}/memberships/sell`, T, { membershipPlanId: planId, paymentMethod: provider === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'CASH' });
    return r.status < 300 ? 1 : (console.log('sell', r.status, JSON.stringify(r.body).slice(0, 200)), 0);
  });
  const entry = { i, ck, provider, tz: c.tz, cur: c.cur, price: c.price, sid, branchId: branch.id, owner, acctId: acct.id, stripeAcct, plans: Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.id])), waiverId: waiver.id, memberIds: users.map((u) => u.id), sold: sold.reduce((a, b) => a + b, 0), seconds: (Date.now() - t0) / 1000 };
  console.log(`School ${i} ${ck} ${provider}: ${users.length} members imported, ${entry.sold} sold, ${entry.seconds}s`);
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const i of only) {
    if (cast.schools.find((s) => s.i === i)) continue;
    try {
      const e = await seedSchool(i);
      cast.schools.push(e);
      saveCast(cast);
    } catch (err) { console.log(`School ${i} FAILED`, err.message); }
  }
  await db.$disconnect();
}
