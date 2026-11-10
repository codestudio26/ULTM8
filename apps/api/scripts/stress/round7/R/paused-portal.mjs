// Round 7 R: what a paused Branch Staff member sees in the School Portal after signing in.
import fs from 'fs';
import { chromium } from 'playwright';
import { call, signIn } from '../../../rehearsal/lib.mjs';
const cast = JSON.parse(fs.readFileSync(process.argv[2]));
const who = process.argv[3] || 'A', lang = process.argv[4] || 'en-GB';
const c = cast[who], sid = c.schoolId, PORTAL = process.env.PORTAL || 'http://localhost:5383';
await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS || 0)));
await signIn(c.owner);
await call('POST', `/schools/${sid}/staff/${c.staff.id}/pause`, c.owner.tok, {});
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, locale: lang });
const page = await ctx.newPage();
await page.goto(PORTAL + '/login', { waitUntil: 'networkidle' });
await page.locator('input[type=email]').fill(c.staff.email);
await page.locator('input[type=password]').fill(c.staff.passcode);
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(5000);
const shots = [];
for (const path of [null, '/students', '/classes', '/sign-ups', '/payroll']) {
  if (path) { await page.goto(PORTAL + path, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(2500); }
  const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300);
  shots.push(`${page.url().replace(PORTAL, '')}: ${t}`);
  await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/paused-${who}-${(path || 'home').replace('/', '')}.png` });
}
console.log(shots.join('\n\n'));
await call('POST', `/schools/${sid}/staff/${c.staff.id}/unpause`, c.owner.tok, {});
await b.close();
