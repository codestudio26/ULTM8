// Round 7 R: pt-BR pass on the screens added since rehearsal 2 (Decisions 449/450):
// Franchise overview, the coach's Access window ("Manage students"), the Fees tile,
// the refusal messages (ACCESS_PAUSED / NO_PERMISSION), and the member app's
// "Buy a plan" text. Usage (rehearsal env, PORTAL, CHROMIUM):
//   node --import ../../../rehearsal/ts-resolve.mjs ptbr-new-screens.mjs <rehearsal cast> <clean cast>
import fs from 'fs';
import { chromium } from 'playwright';
import { call, signIn, db, journey, check, ok, save } from '../../../rehearsal/lib.mjs';
const PORTAL = process.env.PORTAL || 'http://localhost:5383';
const reh = JSON.parse(fs.readFileSync(process.argv[2])), clean = JSON.parse(fs.readFileSync(process.argv[3]));
const root = new URL('../../../../../../', import.meta.url).pathname;
function flat(o, p = '', out = {}) { for (const [k, v] of Object.entries(o ?? {})) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; }
const en = flat((await import(root + 'apps/school-portal/src/i18n/messages/en-GB.ts')).messages);
const pt = flat((await import(root + 'apps/school-portal/src/i18n/messages/pt-BR.ts')).messages);
const { SERVER_MESSAGES } = await import(root + 'packages/i18n/src/server/en.ts');
const english = [...new Set([...Object.keys(en).filter((k) => typeof en[k] === 'string' && !k.startsWith('server.') && en[k] !== pt[k]).map((k) => en[k]), ...SERVER_MESSAGES])]
  .map((s) => s.replace(/\{[^}]+\}.*$/, '').trim()).filter((s) => s.length >= 16 && / [a-z]+ /.test(s));
const rawKeyRe = /\b(?:[a-z][a-zA-Z0-9]*\.){2,}[a-zA-Z0-9]+\b/g;
const scan = (text) => ({ raw: (text.replace(/\S+@\S+/g, ' ').match(rawKeyRe) || []).filter((k) => !/\.(test|com|br|org|internal)$/.test(k)), leftovers: english.filter((x) => text.includes(x)) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function portalAs(person, schoolId) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
  await ctx.addInitScript((sid) => { try { localStorage.setItem('ultm8.language', 'pt-BR'); if (sid) localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, schoolId);
  const page = await ctx.newPage();
  await page.goto(PORTAL + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').first().fill(person.email);
  await page.locator('input[type="password"]').first().fill(person.passcode);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  return page;
}
async function view(page, path, extra) {
  await page.goto(PORTAL + path, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (extra) await extra(page);
  const text = await page.evaluate(() => document.body.innerText);
  return { text, ...scan(text), lang: await page.evaluate(() => document.documentElement.lang) };
}
const ev = (r, needle) => `lang ${r.lang}; ${needle}; raw [${r.raw.slice(0, 5)}]; English [${r.leftovers.slice(0, 3).join(' | ')}]`;

journey('B', 'R7', 'pt-BR: screens added since rehearsal 2');
let page;
const SKIP = new Set((process.env.SKIP || '').split(','));
if (!SKIP.has('1')) {
// 1. Franchise overview: School B's owner makes a Franchise and joins School B to it.
const B = reh.B; await signIn(B.owner);
const fr = await call('POST', '/franchises', B.owner.tok, { name: 'Rede Ensaio R7', acceptAgreement: true });
const join = await call('POST', `/schools/${B.schoolId}/join-franchise`, B.owner.tok, { franchiseId: fr.body?.id });
let accepted = join.status;
const reqs = await call('GET', `/franchises/${fr.body?.id}/join-requests`, B.owner.tok);
for (const r of reqs.body?.items ?? reqs.body?.data ?? (Array.isArray(reqs.body) ? reqs.body : [])) { if (r.status === 'PENDING' || !r.status) accepted = (await call('POST', `/franchises/${fr.body.id}/join-requests/${r.id}/accept`, B.owner.tok, {})).status; }
await signIn(B.owner);
const ovApi = await call('GET', `/franchises/${fr.body?.id}/overview`, B.owner.tok);
page = await portalAs(B.owner, B.schoolId);
const ov = await view(page, `/franchises/${fr.body?.id}/overview`);
ok('Franchise overview page in pt-BR: no raw keys, no English', fr.status < 300 && ovApi.status === 200 && ov.lang === 'pt-BR' && !ov.raw.length && !ov.leftovers.length,
  `franchise ${fr.status}; join ${join.status}/${accepted}; API overview ${ovApi.status} (${(ovApi.body?.schools ?? []).length} Schools); ` + ev(ov, `"${ov.text.replace(/\s+/g, ' ').slice(ov.text.indexOf('Visão') > 0 ? ov.text.replace(/\s+/g, ' ').indexOf('Visão') : 0).slice(0, 160)}"`));
// The role label for a Franchise owner (Decision 450 item 3).
const head = await view(page, '/dashboard');
check('the Franchise owner role label is translated, not FRANCHISE_OWNER', /FRANCHISE_OWNER|SCHOOL_OWNER_MANAGER/.test(head.text) ? 'FAIL' : 'PASS', ev(head, 'header/dashboard'));
await page.context().close();
}

// 2. Billing reports with a fee (School A had a no-show fee in J9), viewed in pt-BR.
const A = reh.A; await signIn(A.owner);
const bo = await call('GET', `/schools/${A.schoolId}/charge-reports/overview`, A.owner.tok);
const feesApi = (bo.body?.currencies ?? []).map((c) => `${c.currency} fees ${c.fees}`).join(', ');
page = await portalAs(A.owner, A.schoolId);
// Signed in, the portal uses the owner's own language (en-GB): switch it in the header, as a person would.
const billingPath = '/billing-reports';
await view(page, billingPath);
await page.locator('select').filter({ hasText: 'Português' }).first().selectOption('pt-BR').catch((e) => console.log('select', String(e).slice(0, 100)));
await page.waitForTimeout(1500);
const bill = await view(page, billingPath);
const feesWord = Object.entries(pt).filter(([k, v]) => /fees/i.test(k) && /overview|tile|billing|chargeReports/i.test(k)).map(([, v]) => v).filter((v) => typeof v === 'string' && v.length < 20);
ok('Billing reports with fees, pt-BR: the Fees tile is translated, no English', bill.lang === 'pt-BR' && !bill.raw.length && !bill.leftovers.length && feesWord.some((w) => bill.text.includes(w)),
  `path ${billingPath}; API ${feesApi}; fee words ${JSON.stringify(feesWord.slice(0, 3))}; ` + ev(bill, `"${bill.text.replace(/\s+/g, ' ').slice(300, 520)}"`));
await page.context().close();

if (!SKIP.has('3')) {
// 3. The coach's Access window, clean School B (its coach exists there).
const C = clean.B; await signIn(C.owner);
const coach = await db.roleGrant.findFirst({ where: { schoolId: C.schoolId, role: 'INSTRUCTOR', revokedAt: null }, select: { userId: true } });
page = await portalAs(C.owner, C.schoolId);
const staff = await view(page, '/staff', async (pg) => {
  const u = await db.user.findUnique({ where: { id: coach.userId }, select: { firstName: true, surname: true } });
  const row = pg.locator('tr', { hasText: u.firstName }).first();
  await row.locator('button').last().click().catch(() => {});
  await pg.waitForTimeout(500);
  await pg.getByText(pt['roleGrants.access.action'] ?? 'Acesso', { exact: true }).first().click().catch(() => {});
  await pg.waitForTimeout(1200);
});
ok('the coach\'s Access window in pt-BR shows "Gerenciar alunos", no English', staff.text.includes(pt['roleGrants.access.coachManageStudents'] ?? 'Gerenciar alunos') && staff.text.includes((pt['roleGrants.access.coachIntro'] ?? '').slice(0, 30)) && !staff.raw.length && !staff.leftovers.length,
  `coach ${!!coach}; ` + ev(staff, `intro shown ${staff.text.includes((pt['roleGrants.access.coachIntro'] ?? '').slice(0, 30))}`));
await page.context().close();
}

// 4. The refusal texts in every pt-BR table (portal server codes, member app, server keys).
const appPt = flat((await import(root + 'apps/student/src/i18n/messages/pt-BR.ts')).messages ?? (await import(root + 'apps/student/src/i18n/messages/pt-BR.ts')).default);
const appEn = flat((await import(root + 'apps/student/src/i18n/messages/en.ts')).messages ?? (await import(root + 'apps/student/src/i18n/messages/en.ts')).default);
const pick = (o, re) => Object.entries(o).filter(([k]) => re.test(k));
const sPt = flat((await import(root + 'packages/i18n/src/serverKeys/pt-BR.ts')).server);
const sEn = flat((await import(root + 'packages/i18n/src/serverKeys/en.ts')).server);
const rows = [...pick(sPt, /accessPaused|noPermission|noEligibleMembership/i).map(([k, v]) => ['server-keys', k, v, sEn[k]]), ...pick(appPt, /accessPaused|noPermission|buyPlan|noEligible/i).map(([k, v]) => ['app', k, v, appEn[k]])];
ok('ACCESS_PAUSED / NO_PERMISSION / Buy a plan: translated in the portal and the member app (pt-BR differs from English)', rows.length >= 5 && rows.every(([, , v, e]) => typeof v === 'string' && v && v !== e), rows.map(([w, k, v]) => `${w} ${k}="${v}"`).join('; '));
// 5. The member app's no-plan refusal now carries NO_ELIGIBLE_MEMBERSHIP (the code the "Buy a plan" button keys on).
const cl = await db.class.findFirst({ where: { schoolId: reh.B.schoolId, startDate: { gt: new Date() }, archivedAt: null, cancelledAt: null }, select: { id: true } });
const extra = reh.B.extra; await signIn(extra);
const bk = cl ? await call('POST', `/classes/${cl.id}/book`, extra.tok, {}) : { status: 0 };
check('booking with no plan: the refusal is NO_ELIGIBLE_MEMBERSHIP (or an earlier gate)', bk.body?.error?.code === 'NO_ELIGIBLE_MEMBERSHIP' ? 'PASS' : 'NOTE', `${bk.status} ${bk.body?.error?.code ?? ''} ${bk.body?.error?.message ?? ''}`);
save(`ptbr-new-screens-${Date.now().toString(36)}.json`);
await browser.close(); await db.$disconnect();
