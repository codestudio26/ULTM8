// The member app (apps/student, exported for the web with Expo) in a real
// browser, in pt-BR, as School B's adult member: pick the School by its join
// code, sign in, then open the main screens. Each screen is checked for raw
// message keys and for English text that has a pt-BR translation, and the
// plans screen for the "no card payments here" note (Decision 439 item 5).
//
//   (cd apps/student && npx expo export -p web --output-dir <dir>)  with
//   app.json's extra.apiBaseUrl pointing at the API; serve <dir> on MEMBER_APP.
//   node --import ./ts-resolve.mjs member.mjs [cast-<run>.json]
//   MEMBER_APP  default http://localhost:5318     CHROMIUM  a Chromium binary
import fs from 'fs';
import { createRequire } from 'module';
import { journey, check, ok, save, db } from './lib.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = process.env.MEMBER_APP || 'http://localhost:5318';
const dir = new URL('./', import.meta.url).pathname;
const castFile = process.argv[2] || fs.readdirSync(dir).filter((f) => /^cast-.*\.json$/.test(f)).map((f) => [f, fs.statSync(dir + f).mtimeMs]).sort((a, b) => b[1] - a[1])[0]?.[0];
const cast = JSON.parse(fs.readFileSync(dir + castFile));
const B = cast.B;

function flat(o, p = '', out = {}) { for (const [k, v] of Object.entries(o ?? {})) { const key = p ? `${p}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v; } return out; }
const root = new URL('../../../../', import.meta.url).pathname;
const en = flat((await import(root + 'apps/student/src/i18n/messages/en.ts')).messages);
const pt = flat((await import(root + 'apps/student/src/i18n/messages/pt-BR.ts')).messages);
const english = [...new Set(Object.keys(en).filter((k) => typeof en[k] === 'string' && en[k] !== pt[k]).map((k) => en[k].replace(/\{[^}]+\}.*$/, '').trim()))]
  .filter((s) => s.length >= 14 && / [a-z]+ /.test(s));
const rawKeyRe = /\b(?:[a-z][a-zA-Z0-9]*\.){2,}[a-zA-Z0-9]+\b/g;
const scan = (text) => ({
  raw: (text.replace(/\S+@\S+/g, ' ').match(rawKeyRe) || []).filter((k) => !/\.(test|com|br|org|internal)$/.test(k)),
  leftovers: english.filter((s) => text.includes(s)),
});

journey('B', '6', 'Language: pt-BR (member app in a browser)');
const school = await db.school.findUnique({ where: { id: B.schoolId }, select: { joinCode: true, name: true } });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, locale: 'pt-BR' });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
const text = async () => page.evaluate(() => document.body.innerText);
// React Navigation keeps earlier screens in the page, hidden: only click what shows.
const shown = (label) => page.getByText(label, { exact: true }).locator('visible=true').first();
const seen = {};

/** Back to Home: the web build keeps no history, so open the app again and
 *  sign in again if it asks. */
async function home() {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (await page.getByRole('tab', { name: 'Código de entrada' }).count()) {
    await page.getByRole('tab', { name: 'Código de entrada' }).click();
    await page.locator('input').first().fill(school.joinCode);
    await page.getByText('Encontrar minha escola', { exact: false }).first().click().catch(() => page.keyboard.press('Enter'));
    await page.waitForTimeout(1500);
    await page.getByText(school.name).first().click();
    await page.waitForTimeout(800);
  }
  if (await page.locator('input[type=email]').count()) {
    seen.login ??= await text();
    // Sign-in allows 20 tries a minute from one address.
    await page.waitForTimeout(seen.home ? 13000 : 0); // and 5 a minute for one email
    await page.locator('input[type=email]').fill(B.adult.email);
    await page.locator('input[type=password]').fill(B.adult.passcode);
    await page.getByText(/^Entrar$/).last().click();
    await page.waitForTimeout(3500);
  }
}
await home();
seen.home = await text();
ok('School B\'s member picks the School by join code and signs in, in pt-BR', !/Código de acesso/.test(seen.home) && seen.home.length > 40, seen.home.slice(0, 160).replace(/\n/g, ' / '));

// Open each Home button, keep what the screen shows, and come back.
async function visit(name, label, then) {
  const target = shown(label);
  if (!(await target.count())) { seen[name] = null; return; }
  await target.click().catch(() => {});
  await page.waitForTimeout(2000);
  if (then) await then();
  seen[name] = await text();
  // The header's back arrow (as a member would), else open the app again.
  for (let i = 0; i < (then ? 2 : 1); i++) {
    const back = page.locator('[aria-label="Voltar"], [aria-label="Go back"], [aria-label*="back" i]').locator('visible=true').first();
    if (await back.count()) { await back.click().catch(() => {}); await page.waitForTimeout(800); }
  }
  if (!(await shown(pt['home.myProfile']).count())) await home();
}
for (const key of ['myMemberships', 'myBookings', 'waivers', 'notifications', 'myGrading', 'paymentHistory', 'myMinors']) await visit(key, pt[`home.${key}`]);
await visit('charges', pt['charges.home']);
// The School's page, where a member buys a plan.
await visit('schoolPlans', pt['home.browseAcademies'], async () => { await page.getByText(school.name).locator('visible=true').first().click().catch(() => {}); await page.waitForTimeout(2000); });
// Profile, and the "Delete my account" screen (opened, not confirmed).
await visit('profile', pt['home.myProfile']);
const delLabel = Object.entries(pt).find(([k, v]) => /accountDeletion|deleteAccount/.test(k) && typeof v === 'string' && /^Excluir/.test(v))?.[1];
if (delLabel) await visit('deleteAccount', pt['home.myProfile'], async () => { await shown(delLabel).click().catch(() => {}); await page.waitForTimeout(2000); });
fs.writeFileSync(`${dir}member-screens-${castFile.replace(/^cast-|\.json$/g, '')}.json`, JSON.stringify(seen, null, 1));

const bad = [];
for (const [name, t] of Object.entries(seen)) {
  if (!t) continue;
  const r = scan(t);
  if (r.raw.length || r.leftovers.length) bad.push(`${name}: ${[...new Set(r.raw)].slice(0, 3).join(' ')} ${r.leftovers.slice(0, 3).map((s) => `"${s.slice(0, 60)}"`).join(' ')}`.trim());
}
const visited = Object.entries(seen).filter(([, t]) => t).map(([n]) => n);
ok(`member app screens (${visited.join(', ')}): no raw keys and no untranslated English`, bad.length === 0, bad.join(' || ') || 'clean');
const noteKey = Object.keys(pt).find((k) => /Pix/.test(String(pt[k])) && /cart/i.test(String(pt[k])));
const note = noteKey ? String(pt[noteKey]).slice(0, 40) : null;
const where = Object.entries(seen).find(([, t]) => t && note && t.includes(note));
check('the "card payments aren\'t available, pay by Pix or cash" note shows where they would pay', where ? 'PASS' : 'NOTE', where ? `on the ${where[0]} screen: "${note}…"` : `not seen on ${visited.join(', ')} (key ${noteKey}); screens saved for review`);
check('member app console errors', consoleErrors.length ? 'NOTE' : 'PASS', consoleErrors.slice(0, 4).join(' | ') || 'none');
await page.screenshot({ path: `${dir}member-B-${visited[visited.length - 1] ?? 'home'}.png` }).catch(() => {});
await browser.close();
save(`member-results-${castFile.replace(/^cast-|\.json$/g, '')}.json`);
await db.$disconnect();
