// The School Portal in a real browser, after rehearsal.mjs: School B's owner
// signs in through the login page and reads the portal in pt-BR; School B's
// Branch Staff open the payroll report (rates hidden, then shown); School A's
// owner sees the Connect Stripe step. Every page is checked for raw message
// keys and for English text that has a pt-BR translation.
//
//   node --import ./ts-resolve.mjs portal.mjs [cast-<run>.json]
//   PORTAL   the served portal (default http://localhost:5317)
//   CHROMIUM a Chromium binary, if Playwright has none downloaded
import fs from 'fs';
import { createRequire } from 'module';
import { call, journey, check, ok, save, db } from './lib.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORTAL = process.env.PORTAL || 'http://localhost:5317';
const dir = new URL('./', import.meta.url).pathname;
const castFile = process.argv[2] || fs.readdirSync(dir).filter((f) => /^cast-.*\.json$/.test(f)).map((f) => [f, fs.statSync(dir + f).mtimeMs]).sort((a, b) => b[1] - a[1])[0]?.[0];
const cast = JSON.parse(fs.readFileSync(dir + castFile));
console.log(`Portal check with ${castFile} against ${PORTAL}\n`);

// English texts that have a different pt-BR text: seeing one on a pt-BR page means it wasn't translated.
function flat(o, p = '', out = {}) { for (const [k, v] of Object.entries(o ?? {})) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; }
const root = new URL('../../../../', import.meta.url).pathname;
const en = flat((await import(root + 'apps/school-portal/src/i18n/messages/en-GB.ts')).messages);
const pt = flat((await import(root + 'apps/school-portal/src/i18n/messages/pt-BR.ts')).messages);
const { SERVER_MESSAGES } = await import(root + 'packages/i18n/src/server/en.ts');
const english = [...new Set([
  ...Object.keys(en).filter((k) => typeof en[k] === 'string' && !k.startsWith('server.') && en[k] !== pt[k]).map((k) => en[k]),
  ...SERVER_MESSAGES,
])].map((s) => s.replace(/\{[^}]+\}.*$/, '').trim()).filter((s) => s.length >= 16 && / [a-z]+ /.test(s));
const rawKeyRe = /\b(?:[a-z][a-zA-Z0-9]*\.){2,}[a-zA-Z0-9]+\b/g;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function tokenFor(person) {
  const r = await call('POST', '/auth/login', null, { email: person.email, passcode: person.passcode });
  return r.body.accessToken;
}
async function open(page, path) {
  const errors = [];
  const onResp = (r) => { if (r.url().includes('/v1/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); };
  page.on('response', onResp);
  await page.goto(PORTAL + path, { waitUntil: 'networkidle', timeout: 45_000 }).catch((e) => errors.push(String(e).slice(0, 120)));
  await page.waitForTimeout(400);
  page.off('response', onResp);
  const text = await page.evaluate(() => document.body.innerText);
  const raw = (text.replace(/\S+@\S+/g, ' ').match(rawKeyRe) || []).filter((k) => !/\.(test|com|br|org|internal)$/.test(k));
  const leftovers = english.filter((s) => text.includes(s));
  return { text, raw, leftovers, errors, lang: await page.evaluate(() => document.documentElement.lang) };
}

// --- School B's owner, pt-BR, through the real login page ---
journey('B', '6', 'Language: pt-BR (portal in a browser)');
const B = cast.B;
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(PORTAL + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(B.owner.email);
  await page.locator('input[type="password"], input[name="passcode"]').first().fill(B.owner.passcode);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  ok('School B\'s owner signs in through the portal login page', !page.url().includes('/login'), page.url().replace(PORTAL, ''));
  await page.evaluate((sid) => { try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, B.schoolId);

  const dash = await open(page, '/dashboard');
  const stripeStep = await page.locator('li[data-step="STRIPE"]').count();
  const note = await page.locator('[data-testid="stripe-unavailable"]').innerText().catch(() => '');
  ok('pt-BR Dashboard: no "Connect Stripe" step; the Pix/cash note shows in Portuguese', dash.lang === 'pt-BR' && stripeStep === 0 && /Pix/.test(note) && /dinheiro|transferência/.test(note), `lang ${dash.lang}; Stripe steps ${stripeStep}; note "${note}"`);
  const pages = ['/dashboard', '/students', '/staff', '/membership-plans', '/membership-plans/new', '/transactions', '/payroll', '/waivers', '/timetable', '/cancellations', '/notifications', '/school', '/check-in', '/front-desk'];
  const bad = [];
  for (const p of pages) {
    const r = p === '/dashboard' ? dash : await open(page, p);
    if (r.raw.length || r.leftovers.length || r.errors.length) bad.push(`${p}: ${[...new Set(r.raw)].slice(0, 3).join(' ')} ${r.leftovers.slice(0, 3).map((s) => `"${s.slice(0, 50)}"`).join(' ')} ${r.errors.join(' ')}`.trim());
    if (p === '/notifications') {
      const n = await db.notification.findMany({ where: { userId: B.owner.id }, select: { title: true } });
      const englishTitles = [...new Set(n.map((x) => x.title))].filter((t) => r.text.includes(t));
      ok('pt-BR Notifications: the owner\'s notices show in Portuguese', englishTitles.length === 0, `${n.length} notices; English titles on screen: ${englishTitles.join(' | ') || 'none'}`);
    }
  }
  ok(`pt-BR portal: ${pages.length} pages with no raw keys, no untranslated English and no server errors`, bad.length === 0, bad.join(' || ') || pages.join(' '));
  await page.screenshot({ path: `${dir}portal-B-dashboard.png` }).catch(() => {});
  await ctx.close();
}

// --- School B's Branch Staff: the payroll report ---
journey('B', '2', 'Staff and payroll (portal in a browser)');
{
  const tok = await tokenFor(B.staff);
  const ownerTok = await tokenFor(B.owner);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [tok, B.schoolId]);
  const page = await ctx.newPage();
  const r1 = await open(page, '/payroll');
  const owner = await db.user.findUnique({ where: { id: B.owner.id } });
  const hasCoach = r1.text.includes(owner.firstName);
  ok('Branch Staff with Payroll open the report in the portal; no pay rates shown', hasCoach && !/30,00/.test(r1.text) && !/15,00/.test(r1.text), `coach listed ${hasCoach}; rates on page ${/30,00|15,00/.test(r1.text)}`);
  const ratesPage = await open(page, '/payroll?tab=rates');
  await call('PATCH', `/schools/${B.schoolId}`, ownerTok, { payrollStaffSeeRates: true });
  const r2 = await open(page, '/payroll');
  ok('after the owner turns on "Show pay rates in the report", the rates show (read only)', /30,00/.test(r2.text) && /15,00/.test(r2.text), `rates on page ${/30,00/.test(r2.text)}; editable inputs ${await page.locator('input[type="number"]').count()}`);
  await call('PATCH', `/schools/${B.schoolId}`, ownerTok, { payrollStaffSeeRates: false });
  check('payroll page as Branch Staff, raw keys / English', r1.raw.length || r1.leftovers.length ? 'FAIL' : 'PASS', `${r1.raw.join(' ')} ${r1.leftovers.join(' | ')}`.trim() || 'none');
  void ratesPage;
  await ctx.close();
}

// --- School A's owner: the Connect Stripe step is there ---
journey('A', '1', 'Owner set-up (portal in a browser)');
{
  const A = cast.A;
  const tok = await tokenFor(A.owner);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [tok, A.schoolId]);
  const page = await ctx.newPage();
  const r = await open(page, '/dashboard');
  const stripeStep = await page.locator('li[data-step="STRIPE"]').count();
  const note = await page.locator('[data-testid="stripe-unavailable"]').count();
  ok('UK Dashboard: the "Connect Stripe" step is listed and the no-cards note is not', stripeStep === 1 && note === 0, `lang ${r.lang}; Stripe steps ${stripeStep}; note ${note}`);
  const bad = [];
  for (const p of ['/students', '/staff', '/membership-plans', '/transactions', '/payroll', '/waivers', '/timetable', '/cancellations', '/notifications', '/school']) {
    const x = await open(page, p);
    if (x.raw.length || x.errors.length) bad.push(`${p}: ${x.raw.slice(0, 3).join(' ')} ${x.errors.join(' ')}`);
  }
  ok('UK owner\'s main pages: no raw keys and no server errors', bad.length === 0, bad.join(' || ') || 'clean');
  // Phone width: the payroll page and the Dashboard don't scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = [];
  for (const p of ['/dashboard', '/payroll', '/membership-plans']) {
    await open(page, p);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) wide.push(p);
  }
  ok('phone width: Dashboard, Payroll and Plans don\'t scroll sideways', wide.length === 0, wide.join(', ') || 'none');
  await ctx.close();
}

// --- Rehearsal 2: what was built since rehearsal 1 -------------------------
const ptKey = (suffix) => Object.keys(pt).find((k) => k.endsWith(suffix));
const loginThroughPage = async (page, email, passcode) => {
  await page.goto(PORTAL + '/login', { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"], input[name="passcode"]').first().fill(passcode);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
};
const scanText = (text) => ({
  raw: (text.replace(/\S+@\S+/g, ' ').match(rawKeyRe) || []).filter((k) => !/\.(test|com|br|org|internal)$/.test(k)),
  leftovers: english.filter((x) => text.includes(x)),
});

journey('B', '8', 'Portal in a browser (pt-BR): new screens');
{
  // The legal pages, without signing in.
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  // A first visit: before signing in, with nothing chosen in this browser,
  // the portal uses the browser's language (Decision 449 item 3; it was
  // English in rehearsal 2, a note then). English now is a failure.
  const first = await open(page, '/legal/terms-and-conditions');
  check('a first visit to a legal page, browser in Portuguese, nothing chosen yet', /Terms of Service/.test(first.text) || first.lang !== 'pt-BR' ? 'FAIL' : 'PASS', `lang ${first.lang}: "${first.text.trim().slice(0, 90).replace(/\n/g, ' / ')}" (Decision 449 item 3: the browser's language when nothing was chosen)`);
  await page.evaluate(() => localStorage.setItem('ultm8.language', 'pt-BR'));
  const bad = [];
  for (const slug of ['terms-and-conditions', 'privacy-statement', 'school-agreement', 'children-notice', 'cookie-notice']) {
    const r = await open(page, `/legal/${slug}`);
    if (r.raw.length || r.leftovers.length || r.errors.length || r.text.trim().length < 20) bad.push(`${slug}: ${r.raw.slice(0, 2).join(' ')} ${r.leftovers.slice(0, 2).join(' | ')} ${r.errors.join(' ')} (${r.text.trim().length} chars)`);
  }
  const lp = await open(page, '/legal/terms-and-conditions');
  ok('with Portuguese chosen, the five legal pages open without signing in, in Portuguese', bad.length === 0 && /Termos/.test(lp.text), bad.join(' || ') || `lang ${lp.lang}; "${lp.text.trim().slice(0, 80).replace(/\n/g, ' / ')}"`);

  // A member the School added: first sign-in through the login page shows "I agree".
  const ownerTok = await tokenFor(B.owner);
  const RUNP = Date.now().toString(36);
  const branch = await db.branch.findFirst({ where: { schoolId: B.schoolId } });
  const add = await call('POST', `/schools/${B.schoolId}/students/add-manually`, ownerTok, { firstName: 'Clara', surname: 'Teixeira', email: `clara.teixeira.${RUNP}@rehearsal.test`, dateOfBirth: '1990-10-10', branchId: branch.id });
  const l = add.body?.temporaryPasscode ? await call('POST', '/auth/login', null, { email: add.body.email, passcode: add.body.temporaryPasscode }) : null;
  const ch = l?.body?.passcodeChangeToken ? await call('POST', '/auth/passcode-change/first-login', l.body.passcodeChangeToken, { newPasscode: '615283' }) : null;
  if (ch?.status < 300) {
    await loginThroughPage(page, add.body.email, '615283');
    const text = await page.evaluate(() => document.body.innerText);
    const sc = scanText(text);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const shown = /Antes de continuar|Termos de Serviço/.test(text);
    ok('a member the School added signs in to the portal and sees the "I agree" step first, in Portuguese', shown && sc.raw.length === 0 && sc.leftovers.length === 0,
      `lang ${lang}; "${text.trim().slice(0, 160).replace(/\n/g, ' / ')}"; raw ${sc.raw.join(' ')}; English ${sc.leftovers.slice(0, 3).join(' | ')}`);
    const links = await page.locator('a[href*="/legal/"]').count();
    await page.locator('input[type="checkbox"]').first().check().catch(() => {});
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => document.body.innerText);
    const rows = await db.legalAcceptance.count({ where: { userId: add.body.id, atFirstSignIn: true } });
    ok('ticking it records the acceptance and opens the portal', !/Antes de continuar/.test(after) && rows === 2, `links to the pages ${links}; acceptance rows ${rows}; now "${after.trim().slice(0, 80).replace(/\n/g, ' / ')}"`);
  } else {
    check('first sign-in "I agree" in the portal', 'BLOCKED', `add ${add.status} ${add.body?.error?.message ?? ''}; login ${l?.status}; change ${ch?.status}`);
  }
  await ctx.close();
}
{
  const tok = await tokenFor(B.owner);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [tok, B.schoolId]);
  const page = await ctx.newPage();
  // No "switch to" on the plan form where the School takes no cards (Decision 441 item 3).
  const form = await open(page, '/membership-plans/new');
  await page.selectOption('#plan-type', 'WEEKLY_PASS').catch(() => {});
  await page.waitForTimeout(800);
  const chosenType = await page.locator('#plan-type').inputValue().catch(() => '?');
  // The form is in steps; "switch to" is on step 3 (Policies).
  await page.getByText(/^3\. /).first().click().catch(() => {});
  await page.waitForTimeout(1000);
  form.text = await page.evaluate(() => document.body.innerText);
  const switchLabel = pt[ptKey('switchToLabel')];
  const typeB = chosenType;
  const switchB = await page.locator('#plan-switch-to').count();
  ok('pt-BR plan form (Weekly Pass, step 3): no "When it ends, switch to" at a School without cards', typeB === 'WEEKLY_PASS' && switchB === 0 && !form.text.toLowerCase().includes(String(switchLabel).toLowerCase()) && form.raw.length === 0 && form.leftovers.length === 0, `type ${typeB}; step ${(await page.getByText(/^3\. /).first().innerText().catch(() => '?'))}; switch field ${switchB}; label "${switchLabel}"; raw ${form.raw.join(' ')}; English ${form.leftovers.slice(0, 2).join(' | ')}`);
  // Symbols-only search: nobody, and a hint (Decision 448 item 13).
  await open(page, '/students');
  await page.locator('#students-search').fill('%');
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => document.body.innerText);
  const hint = pt[ptKey('students.searchSymbolsHint')];
  const rowsShown = await page.locator('table tbody tr').count();
  ok('pt-BR Students: searching "%" shows nobody and explains symbols can\'t be used', !!hint && st.includes(hint) && !st.includes(cast.B.adult ? 'Oliveira' : '#'), `hint shown ${st.includes(hint)}; rows ${rowsShown}; "Oliveira" listed ${st.includes('Oliveira')}`);
  // Pix is offered as a payment method here.
  await open(page, '/transactions');
  const methodsB = await page.locator('#tx-filter-method option').allInnerTexts();
  ok('pt-BR Transactions: Pix is a payment method here', methodsB.some((x) => /Pix/.test(x)), methodsB.join(', '));
  // The monthly member's page: the monthly balance charge and the Payments card.
  if (cast.B.extra) {
    const sp = await open(page, `/students/${cast.B.extra.id}`);
    ok('pt-BR student page of the monthly member: no raw keys, no English, no server errors', sp.raw.length === 0 && sp.leftovers.length === 0 && sp.errors.length === 0, `${sp.raw.join(' ')} ${sp.leftovers.slice(0, 3).join(' | ')} ${sp.errors.join(' ')}`.trim() || 'clean');
  }
  await ctx.close();
}
{
  // Branch Staff: the "Cash payment waiting" notices, in Portuguese.
  const tok = await tokenFor(B.staff);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [tok, B.schoolId]);
  const page = await ctx.newPage();
  const n = await open(page, '/notifications');
  const titles = (await db.notification.findMany({ where: { userId: B.staff.id }, select: { title: true } })).map((x) => x.title);
  const englishTitles = [...new Set(titles)].filter((x) => n.text.includes(x));
  ok('pt-BR Branch Staff notifications ("Cash payment waiting" and the rest) show in Portuguese', titles.includes('Cash payment waiting') && englishTitles.length === 0 && n.raw.length === 0, `${titles.length} notices; English on screen: ${englishTitles.join(' | ') || 'none'}`);
  await ctx.close();
}

journey('A', '8', 'Portal in a browser (UK): Connect Stripe, surcharge line, no Pix');
{
  const A = cast.A;
  const tok = await tokenFor(A.owner);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [tok, A.schoolId]);
  const page = await ctx.newPage();
  await open(page, '/school');
  const card = await page.locator('[data-testid="school-stripe-connect"]').count();
  const status = await page.locator('[data-testid="school-stripe-connect-status"]').innerText().catch(() => '');
  ok('UK School page: the Connect Stripe card shows the account as connected', card === 1 && /connected/i.test(status), `card ${card}; status "${status}"`);
  const tx = await open(page, '/transactions');
  const methods = await page.locator('#tx-filter-method option').allInnerTexts();
  ok('UK Transactions: a "Card surcharges" figure, and no Pix anywhere', /Card surcharges/i.test(tx.text) && !methods.some((x) => /Pix/.test(x)) && !/\bPix\b/.test(tx.text), `surcharge tile ${/Card surcharges/i.test(tx.text)}; methods ${methods.join(', ')}`);
  const form = await open(page, '/membership-plans/new');
  await page.selectOption('#plan-type', 'WEEKLY_PASS').catch(() => {});
  await page.waitForTimeout(800);
  const chosenType = await page.locator('#plan-type').inputValue().catch(() => '?');
  // The form is in steps; "switch to" is on step 3 (Policies).
  await page.getByText(/^3\. /).first().click().catch(() => {});
  await page.waitForTimeout(1000);
  form.text = await page.evaluate(() => document.body.innerText);
  const typeA = chosenType;
  const switchA = await page.locator('#plan-switch-to').count();
  ok('UK plan form (Weekly Pass, step 3) keeps "When it ends, switch to" (the School takes cards)', typeA === 'WEEKLY_PASS' && switchA === 1, `type ${typeA}; switch field ${switchA}`);
  await ctx.close();
}
{
  // The co-owner reads the UK School in Portuguese: the surcharge tile is translated too.
  const A = cast.A;
  if (A.coOwner) {
    const tok = await tokenFor(A.coOwner);
    await call('PATCH', '/users/me', tok, { language: 'pt-BR' });
    const tok2 = await tokenFor(A.coOwner);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [tok2, A.schoolId]);
    const page = await ctx.newPage();
    const tx = await open(page, '/transactions');
    const tile = pt[ptKey('transactions.statSurcharges')];
    const rep = await open(page, '/billing-reports').catch(() => null);
    ok('pt-BR: the card surcharge tile on Transactions is translated', tx.lang === 'pt-BR' && !!tile && tx.text.toLowerCase().includes(tile.toLowerCase()) && tx.raw.length === 0 && tx.leftovers.length === 0,
      `lang ${tx.lang}; tile "${tile}" shown ${tx.text.toLowerCase().includes(tile.toLowerCase())}; raw ${tx.raw.join(' ')}; English ${tx.leftovers.slice(0, 3).join(' | ')}; reports page ${rep ? (rep.raw.length + rep.leftovers.length === 0 ? 'clean' : rep.raw.concat(rep.leftovers).slice(0, 3).join(' | ')) : 'n/a'}`);
    await call('PATCH', '/users/me', tok2, { language: 'en-GB' });
    await ctx.close();
  }
}

await browser.close();
save(`portal-results-${castFile.replace(/^cast-|\.json$/g, '')}.json`);
await db.$disconnect();
