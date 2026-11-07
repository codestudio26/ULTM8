// Round 6 P — Legal acceptance (Decision 444, PR #502), straight at the API.
//  - sign-up without / with a non-true "I agree" tick
//  - under-18 sign-up: birthday today, tomorrow, the Kiritimati edge (pure function)
//  - nothing saved when refused
//  - the version saved is the server's, whatever the client sends
//  - School / Franchise creation without the Agreement tick; editing doesn't take it
//  - LegalAcceptance RLS: own rows only, no update/delete, no insert for someone else
//  - Guardian consent saves the server's Children notice version
import { createRequire } from 'module';
const pg = createRequire(import.meta.url)('pg');
import { call, must, signUp, signIn, db, rec, refused, saveResults, RUN } from './lib.mjs';

const A = 'legal';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
let n = 0;
const body = (over = {}) => {
  const i = n++;
  return { email: `legal.${RUN}.${i}@r6p.test`, phone: `+4479222${String((parseInt(RUN.slice(-3), 36) % 90) * 1000 + i).padStart(5, '0').slice(-5)}`, firstName: 'Lee', surname: 'Gal', passcode: '482913', passcodeConfirm: '482913', dateOfBirth: '1990-01-01', acceptTerms: true, ...over };
};

// 1. The tick.
for (const [label, v] of [['missing', undefined], ['false', false], ['"true" (string)', 'true'], ['1', 1], ['null', null]]) {
  const b = body(); if (v === undefined) delete b.acceptTerms; else b.acceptTerms = v;
  const r = await call('POST', '/auth/register', null, b);
  const saved = await db.user.findFirst({ where: { email: b.email } });
  rec(A, `register with acceptTerms ${label} is refused, nothing saved`, r.status === 400 && !saved, `${r.status} ${r.body?.error?.code} saved=${!!saved}`);
}

// 2. Under 18.
const now = new Date();
const yearsAgo = (y, dayShift = 0) => { const d = new Date(Date.UTC(now.getUTCFullYear() - y, now.getUTCMonth(), now.getUTCDate() + dayShift)); return ymd(d); };
{
  const b = body({ dateOfBirth: yearsAgo(18) });
  const r = await call('POST', '/auth/register', null, b);
  rec(A, `18th birthday today (UTC ${ymd(now)}) may sign up`, r.status < 300, `${r.status} ${r.body?.error?.code ?? ''}`);
}
{
  const b = body({ dateOfBirth: yearsAgo(18, 2) });
  const r = await call('POST', '/auth/register', null, b);
  const saved = await db.user.findFirst({ where: { email: b.email } });
  rec(A, '18th birthday in 2 days is refused REGISTER_UNDER_18, nothing saved', r.status === 403 && r.body?.error?.code === 'REGISTER_UNDER_18' && !saved, `${r.status} ${r.body?.error?.code} saved=${!!saved}`);
}
{
  const b = body({ dateOfBirth: yearsAgo(10) });
  const r = await call('POST', '/auth/register', null, b);
  rec(A, '10-year-old refused', r.status === 403, `${r.status} ${r.body?.error?.code}`);
}
{
  // Under 18 and no tick: which wins doesn't matter, but both must refuse.
  const b = body({ dateOfBirth: yearsAgo(16) }); delete b.acceptTerms;
  const r = await call('POST', '/auth/register', null, b);
  rec(A, '16-year-old without tick refused', r.status >= 400 && r.status < 500, `${r.status} ${r.body?.error?.code}`);
}
// The Kiritimati edge, on the API's own function (dist build), at fixed instants.
{
  const { isAdultOn } = await import('../../../../dist/common/decorators/is-birth-date.decorator.js');
  const dob = new Date('2008-11-08T00:00:00Z'); // 18 on 8 Nov 2026
  const z = 'Pacific/Kiritimati';
  const cases = [
    ['7 Nov 09:59 UTC (Kiritimati 7 Nov 23:59)', '2026-11-07T09:59:00Z', false],
    ['7 Nov 10:00 UTC (Kiritimati 8 Nov 00:00)', '2026-11-07T10:00:00Z', true],
    ['7 Nov 23:59 UTC', '2026-11-07T23:59:00Z', true],
  ];
  for (const [label, t, want] of cases) rec(A, `isAdultOn birthday 8 Nov, at ${label} → ${want}`, isAdultOn(dob, new Date(t), z) === want, String(isAdultOn(dob, new Date(t), z)));
  // A 29 Feb birthday: 18 on 1 Mar in a common year.
  const leap = new Date('2008-02-29T00:00:00Z');
  rec(A, 'isAdultOn 29 Feb 2008 on 28 Feb 2026 (Kiritimati) → false', isAdultOn(leap, new Date('2026-02-27T12:00:00Z'), z) === false);
  rec(A, 'isAdultOn 29 Feb 2008 on 1 Mar 2026 (Kiritimati) → true', isAdultOn(leap, new Date('2026-02-28T12:00:00Z'), z) === true);
}

// 3. The version saved is the server's.
await db.legalDocument.updateMany({ where: { slug: 'terms-and-conditions' }, data: { version: `srv-terms-${RUN}` } });
let me;
{
  me = await signUp({ first: 'Vera', last: 'Version' });
  const r = await call('POST', '/auth/register', null, body({ termsVersion: 'client-1', version: 'client-1', acceptedVersion: 'client-1' }));
  rec(A, 'register with client-sent version fields: refused or ignored (whitelist)', r.status === 400 || r.status < 300, `${r.status} ${(r.body?.error?.message ?? '').toString().slice(0, 100)}`);
  const rows = await db.legalAcceptance.findMany({ where: { userId: me.id } });
  rec(A, 'sign-up records Terms + Privacy at the server version', rows.length === 2 && rows.find((x) => x.documentSlug === 'terms-and-conditions')?.version === `srv-terms-${RUN}` && rows.find((x) => x.documentSlug === 'privacy-statement')?.version === 'unpublished', JSON.stringify(rows.map((x) => [x.documentSlug, x.version])));
}

// 4. School / Franchise creation.
{
  for (const [label, v] of [['missing', undefined], ['false', false], ['"true"', 'true']]) {
    const b = { name: `Legal School ${label} ${RUN}`, timezone: 'Europe/London', defaultCurrency: 'GBP', defaultLanguage: 'en-GB', postalAddress: { line1: '1 St', city: 'London', postalCode: 'E1 6AN', country: 'GB' } };
    if (v !== undefined) b.acceptAgreement = v;
    const r = await call('POST', '/schools', me.tok, b);
    const made = await db.school.findFirst({ where: { name: b.name } });
    rec(A, `create School with acceptAgreement ${label} refused, nothing made`, r.status === 400 && !made, `${r.status} ${r.body?.error?.code} made=${!!made}`);
    const f = await call('POST', '/franchises', me.tok, { name: `Legal Franchise ${label} ${RUN}`, ...(v !== undefined ? { acceptAgreement: v } : {}) });
    const fm = await db.franchise.findFirst({ where: { name: `Legal Franchise ${label} ${RUN}` } });
    rec(A, `create Franchise with acceptAgreement ${label} refused, nothing made`, f.status === 400 && !fm, `${f.status} ${f.body?.error?.code} made=${!!fm}`);
  }
  const s = await must('school', 'POST', '/schools', me.tok, { name: `Legal School ok ${RUN}`, timezone: 'Europe/London', defaultCurrency: 'GBP', defaultLanguage: 'en-GB', postalAddress: { line1: '1 St', city: 'London', postalCode: 'E1 6AN', country: 'GB' }, acceptAgreement: true });
  await signIn(me);
  const rows = await db.legalAcceptance.findMany({ where: { userId: me.id, documentSlug: 'school-agreement' } });
  rec(A, 'School creation records the Agreement with the schoolId', rows.length === 1 && rows[0].schoolId === s.id && rows[0].version === 'unpublished', JSON.stringify(rows));
  const p = await call('PATCH', `/schools/${s.id}`, me.tok, { acceptAgreement: true, name: `Legal School ok2 ${RUN}` });
  const rows2 = await db.legalAcceptance.count({ where: { userId: me.id, documentSlug: 'school-agreement' } });
  rec(A, 'editing the School does not take acceptAgreement / add a row', (p.status === 400 || p.status < 300) && rows2 === 1, `${p.status} ${(p.body?.error?.message ?? '').toString().slice(0, 100)}; rows ${rows2}`);
  const f = await call('POST', '/franchises', me.tok, { name: `Legal Franchise ok ${RUN}`, acceptAgreement: true });
  rec(A, 'Franchise with the tick is created', f.status < 300, `${f.status} ${(f.body?.error?.message ?? '').toString().slice(0, 120)}`);
}

// 5. RLS on LegalAcceptance, as the app's database role.
{
  const other = await signUp({ first: 'Otto', last: 'Other' });
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_APP.replace('?schema=public', '') });
  await c.connect();
  const as = async (uid, sql, params = []) => {
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.current_user_id', $1, true)`, [uid]);
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message }; }
  };
  const mine = await as(me.id, 'SELECT "userId" FROM "LegalAcceptance"');
  rec(A, 'RLS: a user reads only their own LegalAcceptance rows', !mine.error && mine.rows.length > 0 && mine.rows.every((r) => r.userId === me.id), mine.error ?? `${mine.rows.length} rows, all own=${mine.rows.every((r) => r.userId === me.id)}`);
  const none = await as('', 'SELECT count(*)::int n FROM "LegalAcceptance"');
  rec(A, 'RLS: no user context reads nothing', !none.error && none.rows[0].n === 0, none.error ?? JSON.stringify(none.rows));
  const forOther = await as(me.id, `INSERT INTO "LegalAcceptance" ("id","userId","documentSlug","version") VALUES (gen_random_uuid()::text, $1, 'terms-and-conditions', 'forged')`, [other.id]);
  rec(A, "RLS: can't insert a row for someone else", !!forOther.error, forOther.error ?? 'inserted!');
  const upd = await as(me.id, `UPDATE "LegalAcceptance" SET "version"='changed' WHERE "userId"=$1`, [me.id]);
  rec(A, "can't change own rows (append-only)", !!upd.error, upd.error ?? `updated ${upd.rowCount}`);
  const del = await as(me.id, `DELETE FROM "LegalAcceptance" WHERE "userId"=$1`, [me.id]);
  rec(A, "can't delete own rows (append-only)", !!del.error, del.error ?? `deleted ${del.rowCount}`);
  const forgedOwn = await as(me.id, `INSERT INTO "LegalAcceptance" ("id","userId","documentSlug","version") VALUES (gen_random_uuid()::text, $1, 'terms-and-conditions', 'forged-own')`, [me.id]);
  rec(A, 'NOTE: the app role may insert its own row with any version (only the API code fixes the version)', null, forgedOwn.error ?? 'own insert allowed at DB level');
  await c.end();
  // Any HTTP route that returns acceptances?
  for (const path of ['/legal-acceptances', '/users/me/legal-acceptances', `/users/${other.id}/legal-acceptances`, '/legal/acceptances']) {
    const r = await call('GET', path, me.tok);
    rec(A, `no route lists acceptances: GET ${path}`, r.status === 404, `${r.status}`);
  }
}

// 6. Guardian consent saves the server's Children notice version.
{
  await db.legalDocument.updateMany({ where: { slug: 'children-notice' }, data: { version: `srv-children-${RUN}` } });
  const parent = await signUp({ first: 'Gina', last: 'Guardian' });
  const kid = await must('minor', 'POST', '/guardians/me/minors', parent.tok, { firstName: 'Kai', surname: 'Guardian', dateOfBirth: '2017-02-02', consentPolicyVersion: 'client-evil-1' });
  const kidId = kid.id ?? kid.studentId;
  const cam = await call('POST', `/guardians/me/minors/${kidId}/consent`, parent.tok, { tier: 'CAMERA', policyVersion: 'client-evil-2' });
  const rows = await db.consentRecord.findMany({ where: { guardianId: parent.id, studentId: kidId } });
  rec(A, 'consent rows carry the server Children notice version, never the client value', cam.status < 300 && rows.length >= 2 && rows.every((r) => r.policyVersion === `srv-children-${RUN}`), JSON.stringify(rows.map((r) => [r.tier, r.policyVersion])));
  // Another parent can't read/give consent for this child.
  const stranger = await signUp({ first: 'Stu', last: 'Ranger' });
  refused(A, "a stranger can't read the child's consent", await call('GET', `/guardians/me/minors/${kidId}/consent`, stranger.tok));
  refused(A, "a stranger can't give consent for the child", await call('POST', `/guardians/me/minors/${kidId}/consent`, stranger.tok, { tier: 'CAMERA', policyVersion: 'x' }), [400, 403, 404]);
}

await db.legalDocument.updateMany({ where: { slug: { in: ['terms-and-conditions', 'children-notice'] } }, data: { version: 'unpublished' } });
saveResults('legal');
await db.$disconnect();
