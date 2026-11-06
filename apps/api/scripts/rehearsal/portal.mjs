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

await browser.close();
save(`portal-results-${castFile.replace(/^cast-|\.json$/g, '')}.json`);
await db.$disconnect();
