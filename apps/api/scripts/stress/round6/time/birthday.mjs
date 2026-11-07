// Round 6 T: 18th birthdays at sign-up across time zones (Decision 444 item 6)
// and at the School's first actions (Decision 430 item 10, School's own date).
//   node birthday.mjs
// (1) Live, through the API at the real moment: dates of birth whose 18th
//     birthday is yesterday / today / tomorrow on the latest date on Earth
//     (UTC+14), registered now. Then someone who is 18 on that latest date but
//     still 17 in Los Angeles joins an LA School and signs its waiver / buys.
// (2) The pure rules from dist/ at chosen instants: 29 February, the
//     latest/earliest zones, and a School's midnight.
import { createRequire } from 'module';
import { DateTime } from 'luxon';
import { call, must, db, signUp, signIn, ok, note, sectionOf, nextPhone, OTP } from './lib.mjs';
import { seedSchool } from './seed.mjs';
const require = createRequire(import.meta.url);
const { isAdultOn, ageOn } = require('../../../../dist/common/decorators/is-birth-date.decorator.js');

sectionOf('birthday: sign-up now (latest date on Earth)');
const now = DateTime.utc();
const latest = now.setZone('Pacific/Kiritimati').toISODate();
const earliest = now.setZone('Pacific/Pago_Pago').toISODate();
const dob = (d, years = 18) => DateTime.fromISO(d).minus({ years }).toISODate();
const tag = Date.now().toString(36);
const reg = async (first, dateOfBirth) => {
  const phone = nextPhone();
  const r = await call('POST', '/auth/register', null, { email: `${first}.${tag}@round6t.test`.toLowerCase(), phone, firstName: first, surname: 'Bday', passcode: '482913', passcodeConfirm: '482913', dateOfBirth, acceptTerms: true });
  return { r, phone, email: `${first}.${tag}@round6t.test`.toLowerCase() };
};
const cases = [
  ['Yday', dob(DateTime.fromISO(latest).minus({ days: 1 }).toISODate()), true],
  ['Today', dob(latest), true],
  ['Tmrw', dob(DateTime.fromISO(latest).plus({ days: 1 }).toISODate()), false],
];
for (const [first, d, allowed] of cases) {
  const { r } = await reg(first, d);
  ok(`register, 18th birthday ${first} on the latest date (${latest}; DOB ${d})`, (r.status < 300) === allowed, `${r.status} ${r.body?.error?.code ?? ''}`);
}
note('dates now', { utc: now.toISO(), latestOnEarth: latest, earliestOnEarth: earliest, losAngeles: now.setZone('America/Los_Angeles').toISODate(), sydney: now.setZone('Australia/Sydney').toISODate() });

// (1b) 18 on the latest date, but 17 at a School whose day is earlier.
sectionOf('birthday: 18 at sign-up, 17 at the School');
const laDay = now.setZone('America/Los_Angeles').toISODate();
if (laDay < latest) {
  const s = await seedSchool(16, { members: 0, tag: `bd${tag}` }); // USW (Los Angeles), CASH
  const d = dob(latest);
  const { r, phone, email } = await reg('Edge', d);
  if (r.status < 300) {
    await must('otp', 'POST', '/auth/otp/verify', null, { phone, code: OTP });
    const p = { email, passcode: '482913', first: 'Edge', last: 'Bday' };
    await signIn(p);
    p.id = JSON.parse(Buffer.from(p.tok.split('.')[1], 'base64url')).sub;
    const j = await call('POST', `/schools/${s.sid}/join`, p.tok, { branchId: s.branchId });
    const w = await call('POST', `/waivers/${s.waiverId}/sign`, p.tok, { signerFullName: 'Edge Bday', signatureText: 'Edge Bday' });
    const b = await call('POST', `/membership-plans/${s.plans.pack}/purchase`, p.tok, {});
    note('an account made on the latest date\'s 18th birthday, at a Los Angeles School where it is still the day before',
      { dob: d, laDay, join: j.status, waiver: `${w.status} ${w.body?.error?.code ?? w.body?.error?.message ?? ''}`, purchase: `${b.status} ${b.body?.error?.code ?? ''}` });
    // Can a parent add them as a child instead (they are 17 at the School)?
    const parent = await signUp({ first: 'Par', last: 'Bday', tag: `bdp${tag}` });
    const kid = await call('POST', '/guardians/me/minors', parent.tok, { firstName: 'Kid', surname: 'Bday', dateOfBirth: d, consentPolicyVersion: '1.0-placeholder' });
    note('a parent adding a child with that same date of birth', `${kid.status} ${kid.body?.error?.code ?? ''} ${kid.body?.error?.message ?? ''}`);
  }
} else note('skipped 1b', 'LA has already reached the latest date (run between 10:00 and 24:00 UTC)');

sectionOf('birthday: pure rules at chosen instants (dist/)');
const D = (s) => new Date(`${s}T00:00:00.000Z`);
const at = (iso) => new Date(iso);
const rows = [
  // [dob, instant, zone, expected adult]
  ['2008-02-29', '2026-02-28T09:59:00Z', 'Pacific/Kiritimati', false], // Kiritimati 23:59 28 Feb
  ['2008-02-29', '2026-02-28T10:00:00Z', 'Pacific/Kiritimati', true], // Kiritimati 00:00 1 Mar
  ['2008-02-29', '2026-02-28T13:00:00Z', 'Australia/Sydney', true], // Sydney 00:00 1 Mar
  ['2008-02-29', '2026-02-28T12:59:00Z', 'Australia/Sydney', false],
  ['2008-03-29', '2026-03-28T14:00:00Z', 'Australia/Sydney', true], // Sydney 01:00 29 Mar (AEDT)
  ['2008-11-08', '2026-11-08T07:59:00Z', 'America/Los_Angeles', false], // LA 23:59 7 Nov
  ['2008-11-08', '2026-11-08T08:00:00Z', 'America/Los_Angeles', true],
  ['2008-10-25', '2026-10-24T23:00:00Z', 'Europe/London', true], // London 00:00 25 Oct (BST)
  ['2008-10-25', '2026-10-24T22:59:00Z', 'Europe/London', false],
  ['2008-03-14', '2026-03-14T03:00:00Z', 'America/Sao_Paulo', true], // SP 00:00 14 Mar (no DST)
  ['2008-03-14', '2026-03-14T02:59:00Z', 'America/Sao_Paulo', false],
];
const wrong = rows.filter(([d, i, z, exp]) => isAdultOn(D(d), at(i), z) !== exp).map(([d, i, z, exp]) => ({ d, i, z, exp, age: ageOn(D(d), at(i), z) }));
ok('birthday rule: 29 Feb counts from 1 Mar; midnight in the zone, clock changes included', wrong.length === 0, wrong.length ? wrong : `${rows.length} instants`);
await db.$disconnect();
process.exit(0);
