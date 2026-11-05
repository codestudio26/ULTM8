// Arabic catalogue audit: plural forms Arabic needs, texts identical to English (likely leaks), Latin-only texts.
const path = require('path'); const fs = require('fs');
const ts = require(require.resolve('typescript', { paths: ['/home/user/ULTM8/apps/school-portal'] }));
require.extensions['.ts'] = (m, file) => { const src = fs.readFileSync(file, 'utf8'); m._compile(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file); };
const Module = require('module'); const orig = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...r) { if (req === '@ultm8/i18n') return orig.call(this, '/home/user/ULTM8/packages/i18n/src/index.ts', parent, ...r); try { return orig.call(this, req, parent, ...r); } catch (e) { for (const ext of ['.ts', '/index.ts']) { try { return orig.call(this, req + ext, parent, ...r); } catch {} } throw e; } };
const app = process.argv[2];
const base = `/home/user/ULTM8/apps/${app}/src/i18n/messages`;
const en = require(app === 'student' ? `${base}/en.ts` : `${base}/en-GB.ts`).messages;
const ar = require(`${base}/ar.ts`).messages;
const out = { missingPluralForms: [], sameAsEnglish: [], latinOnly: [] };
const need = ['zero', 'one', 'two', 'few', 'many', 'other'];
const isPlural = (v) => v && typeof v === 'object' && typeof v.other === 'string';
function walk(e, a, p) {
  for (const [k, v] of Object.entries(e)) {
    const key = p + k; const av = a ? a[k] : undefined;
    if (typeof v === 'string') {
      if (typeof av === 'string') { if (av === v && /[A-Za-z]{3,}/.test(v)) out.sameAsEnglish.push(`${key}: ${JSON.stringify(v)}`); else if (!/[؀-ۿ]/.test(av) && /[A-Za-z]{3,}/.test(av)) out.latinOnly.push(`${key}: ${JSON.stringify(av)}`); }
    } else if (isPlural(v)) {
      if (isPlural(av)) { const miss = need.filter((f) => typeof av[f] !== 'string'); if (miss.length) out.missingPluralForms.push(`${key}: missing ${miss.join(',')}`); }
    } else walk(v, av, key + '.');
  }
}
walk(en, ar, '');
for (const [k, v] of Object.entries(out)) { console.log(`== ${k}: ${v.length}`); v.slice(0, 60).forEach((x) => console.log('  ' + x)); }
