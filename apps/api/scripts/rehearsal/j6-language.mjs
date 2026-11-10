// Journey 6 (part 1, no browser): School B runs in Brazilian Portuguese.
//  - Every string added since LANG_BASE (default 22cd5e4f, rehearsal 1's
//    merge, so everything built since: Decisions 441–448) in the portal, the member app and the API's
//    error messages has a pt-BR text that isn't the English one.
//  - Every API error message School B's people actually got in this run has a
//    pt-BR text (the apps show the API's English message through that table).
// The browser half is portal.mjs. Run this file with
//   node --import ./ts-resolve.mjs rehearsal.mjs
// so Node can read the apps' TypeScript message files.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { journey, check, ok, errorsSeen } from './lib.mjs';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const BASE = process.env.LANG_BASE || '22cd5e4f'; // rehearsal 1's merge (#504)
const FILES = {
  portalEn: 'apps/school-portal/src/i18n/messages/en-GB.ts',
  portalPt: 'apps/school-portal/src/i18n/messages/pt-BR.ts',
  appEn: 'apps/student/src/i18n/messages/en.ts',
  appPt: 'apps/student/src/i18n/messages/pt-BR.ts',
  serverEn: 'packages/i18n/src/server/en.ts',
  serverPt: 'packages/i18n/src/server/pt-BR.ts',
};

function flat(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
    else out[key] = v;
  }
  return out;
}
async function load(root, file) {
  const m = await import(path.join(root, file));
  return m.messages ?? m.serverMessages ?? m.SERVER_MESSAGES;
}
/** An app's pt-BR messages as the app builds them: its own file plus the
 *  shared server-text keys (packages/i18n SERVER_KEY_LOADERS) under "server". */
async function loadPt(root, file) {
  const own = await load(root, file);
  const { SERVER_KEY_LOADERS } = await import(path.join(root, 'packages/i18n/src/index.ts'));
  const server = SERVER_KEY_LOADERS?.['pt-BR'] ? await SERVER_KEY_LOADERS['pt-BR']() : undefined;
  return { ...own, ...(server ? { server: { ...(own?.server ?? {}), ...(server.default ?? server) } } : {}) };
}
/** A pt-BR text that is just the English copied over, ignoring short or
 *  brand-only strings (Stripe, Pix, ULTM8, "OK", numbers and placeholders). */
const untranslated = (en, pt) => typeof en === 'string' && en === pt && /[a-z]{3,}\s+[a-z]{3,}/i.test(en.replace(/\{[^}]+\}/g, ''));

export async function j6Language(ctx) {
  journey('B', '6', 'Language: pt-BR');
  let baseDir = null;
  try {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-i18n-'));
    const tar = execFileSync('git', ['-C', ROOT, 'archive', BASE, 'apps/school-portal/src/i18n', 'apps/student/src/i18n', 'packages/i18n/src'], { maxBuffer: 64 << 20 });
    execFileSync('tar', ['-x', '-C', baseDir], { input: tar });
    // The base copy's own @ultm8/i18n, for its imports.
    fs.mkdirSync(path.join(baseDir, 'node_modules/@ultm8'), { recursive: true });
    fs.symlinkSync(path.join(baseDir, 'packages/i18n'), path.join(baseDir, 'node_modules/@ultm8/i18n'));
    fs.copyFileSync(path.join(ROOT, 'packages/i18n/package.json'), path.join(baseDir, 'packages/i18n/package.json'));
  } catch (e) {
    check('load the message files at the base commit', 'BLOCKED', String(e.message).slice(0, 200));
    baseDir = null;
  }

  for (const [label, enF, ptF] of [['School Portal', FILES.portalEn, FILES.portalPt], ['member app', FILES.appEn, FILES.appPt]]) {
    const en = flat(await load(ROOT, enF));
    const pt = flat(await loadPt(ROOT, ptF));
    const allMissing = Object.keys(en).filter((k) => typeof en[k] === 'string' && pt[k] === undefined);
    const allSame = Object.keys(en).filter((k) => untranslated(en[k], pt[k]));
    ok(`${label}: every English key has a pt-BR text`, allMissing.length === 0, `${Object.keys(en).length} keys; missing ${allMissing.length}${allMissing.length ? ': ' + allMissing.slice(0, 8).join(', ') : ''}`);
    check(`${label}: pt-BR texts identical to the English`, allSame.length === 0 ? 'PASS' : 'NOTE', `${allSame.length}${allSame.length ? ': ' + allSame.slice(0, 10).map((k) => `${k}="${en[k]}"`).join('; ') : ''}`);
    if (baseDir) {
      const before = flat(await load(baseDir, enF));
      const added = Object.keys(en).filter((k) => before[k] === undefined || before[k] !== en[k]);
      const bad = added.filter((k) => typeof en[k] === 'string' && (pt[k] === undefined || untranslated(en[k], pt[k])));
      ok(`${label}: the ${added.length} strings added or changed since ${BASE} are translated`, bad.length === 0, bad.length ? bad.slice(0, 10).map((k) => `${k}="${String(en[k]).slice(0, 60)}"`).join('; ') : `e.g. ${added.slice(0, 4).map((k) => `${k}="${String(pt[k]).slice(0, 50)}"`).join('; ')}`);
    }
  }

  // The API's English error messages.
  const sEn = await load(ROOT, FILES.serverEn);
  const sPt = await load(ROOT, FILES.serverPt);
  const sMissing = sEn.filter((m) => !sPt[m]);
  ok('API error messages: every one has a pt-BR text', sMissing.length === 0, `${sEn.length} messages; missing ${sMissing.length}${sMissing.length ? ': ' + sMissing.slice(0, 5).join(' | ') : ''}`);
  if (baseDir) {
    const sBefore = new Set(await load(baseDir, FILES.serverEn));
    const added = sEn.filter((m) => !sBefore.has(m));
    const bad = added.filter((m) => !sPt[m] || sPt[m] === m);
    ok(`API error messages added since ${BASE} (${added.length}) are translated`, bad.length === 0, bad.length ? bad.slice(0, 5).join(' | ') : added.slice(0, 3).map((m) => `"${m.slice(0, 50)}…" → "${sPt[m].slice(0, 50)}…"`).join('; '));
  }
  // What School B's people actually saw.
  const seen = [...(errorsSeen.B?.values() ?? [])];
  const coded = seen.filter((e) => e.code && !['BAD_REQUEST', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'UNAUTHORIZED', 'TOO_MANY_REQUESTS'].includes(e.code));
  // Request-validation messages (class-validator's own English) are never in
  // the table: the apps show a translated generic message for them instead.
  const validation = (e) => e.code === 'VALIDATION_ERROR' || /should not exist|must be (a|an|one of|shorter|longer|longer than)|should not be empty/.test(e.message);
  const plain = seen.filter((e) => !coded.includes(e) && !validation(e));
  const notTranslated = plain.filter((e) => !sPt[e.message]);
  ok('every API error School B\'s people got has a pt-BR text (or a code the apps word themselves)', notTranslated.length === 0,
    `${seen.length} distinct errors (${coded.length} with their own code); not in the pt-BR table: ${notTranslated.map((e) => `${e.status} "${e.message}"`).join(' | ') || 'none'}`);
  if (baseDir) fs.rmSync(baseDir, { recursive: true, force: true });
}
