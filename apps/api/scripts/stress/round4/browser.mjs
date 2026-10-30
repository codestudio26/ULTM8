// Round 4, phase 4: the School Portal in a real browser at full data size.
// Signs in (as the e2e tests do, a token in sessionStorage) as the owner of a
// very large School, a small School and an Arabic (right-to-left) School, and as
// Branch Staff; opens every page in the menu at desktop and phone width; records
// load time, API calls, the largest response, console errors and failed calls.
//   PORTAL  the served portal (default http://localhost:4173)
// Writes browser-result.json and screenshots in ./shots/.
import fs from 'fs';
import { createRequire } from 'module';
import { cast, db } from './common.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORTAL = process.env.PORTAL || 'http://localhost:4173';
const PAGES = ['/dashboard', '/students', '/students/add', '/students/sign-ups', '/staff', '/instructors', '/branches', '/franchises', '/classes', '/timetable', '/cancellations',
  '/membership-plans', '/transactions', '/billing-reports', '/waivers', '/waivers/settings', '/notifications', '/check-in', '/check-in/rules', '/front-desk', '/curriculum',
  '/disciplines', '/school', '/profile', '/bookings-drilldown', '/coach-invites'];
fs.mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });

const xl = cast.schools.filter((s) => s.size === 'xlarge').sort((a, b) => b.students.length - a.students.length)[0];
const small = cast.schools.find((s) => s.size === 'small' && s.country === 'GB');
const rtl = cast.schools.find((s) => s.lang === 'ar' && s.size !== 'small');
const personas = [
  { name: 'owner-very-large', s: xl, tok: xl.owner.tok },
  { name: 'owner-small', s: small, tok: small.owner.tok },
  { name: 'owner-arabic', s: rtl, tok: rtl.owner.tok, lang: 'ar' },
  { name: 'branch-staff-very-large', s: xl, tok: xl.staff.tok },
];
// The Arabic School's owner reads the portal in Arabic.
await db.user.update({ where: { id: rtl.owner.id }, data: { language: 'ar' } });

// The repo pins its own Playwright; use the machine's Chromium if that one has no browser downloaded.
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const out = [];
for (const p of personas) {
  for (const vp of [{ w: 1440, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'phone' }]) {
    if (vp.tag === 'phone' && p.name === 'branch-staff-very-large') continue;
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    await ctx.addInitScript(([t, sid]) => { sessionStorage.setItem('ultm8.accessToken', t); try { localStorage.setItem('ultm8.activeSchoolId', sid); } catch {} }, [p.tok, p.s.id]);
    const page = await ctx.newPage();
    for (const path of PAGES) {
      const calls = []; const errors = []; const failed = [];
      const onResp = async (r) => { if (r.url().includes('/v1/')) { let size = 0; try { size = (await r.body()).length; } catch {} calls.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status(), size }); if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`); } };
      const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); };
      const onPageErr = (e) => errors.push('pageerror: ' + String(e).slice(0, 200));
      page.on('response', onResp); page.on('console', onConsole); page.on('pageerror', onPageErr);
      const t0 = Date.now();
      let ok = true;
      try { await page.goto(PORTAL + path, { waitUntil: 'networkidle', timeout: 60_000 }); } catch (e) { ok = false; errors.push('timeout: ' + String(e).slice(0, 120)); }
      const ms = Date.now() - t0;
      await page.waitForTimeout(300);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1).catch(() => null);
      const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction).catch(() => null);
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 20000)).catch(() => '');
      const rawKeys = (bodyText.match(/\b[a-z]+(\.[a-zA-Z]+){2,}\b/g) || []).filter((k) => !k.includes('@') && !/\.(test|com|org)$/.test(k)).slice(0, 5);
      const bigCall = calls.reduce((m, c) => (c.size > (m?.size ?? -1) ? c : m), null);
      const shot = `shots/${p.name}-${vp.tag}${path.replace(/\//g, '_')}.png`;
      if (vp.tag === 'phone' || ms > 3000 || errors.length || failed.length || overflowX) await page.screenshot({ path: new URL('./' + shot, import.meta.url).pathname, fullPage: false }).catch(() => {});
      out.push({ persona: p.name, viewport: vp.tag, path, ms, ok, apiCalls: calls.length, largestKb: bigCall ? Math.round(bigCall.size / 1024) : 0, largestCall: bigCall?.url?.slice(0, 120), apiErrors: calls.filter((c) => c.status >= 400).map((c) => `${c.status} ${c.url.slice(0, 100)}`), consoleErrors: errors.slice(0, 5), failed, overflowX, dir, rawKeys, url: page.url().replace(PORTAL, '') });
      page.off('response', onResp); page.off('console', onConsole); page.off('pageerror', onPageErr);
      console.log(`${p.name} ${vp.tag} ${path}: ${ms} ms, ${calls.length} calls, largest ${bigCall ? Math.round(bigCall.size / 1024) : 0} KB${errors.length ? ', console errors ' + errors.length : ''}${failed.length ? ', 5xx ' + failed.length : ''}${overflowX ? ', SCROLLS SIDEWAYS' : ''}${rawKeys.length ? ', raw keys ' + rawKeys.join(' ') : ''}`);
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(new URL('./browser-result.json', import.meta.url), JSON.stringify(out, null, 1));
const slow = out.filter((r) => r.ms > 2000), big = out.filter((r) => r.largestKb > 1024), err = out.filter((r) => r.consoleErrors.length || r.failed.length), wide = out.filter((r) => r.overflowX);
console.log({ pages: out.length, over2s: slow.length, over1MB: big.length, withErrors: err.length, scrollSideways: wide.length });
await db.$disconnect();
