// Lists the API's routes (method, path) from the controllers' decorators, for
// the existence-leak sweep. Run: node routes.mjs > out/routes.json
import fs from 'fs';
import path from 'path';
const root = new URL('../../../../src/', import.meta.url).pathname;
const out = [];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.controller.ts')) {
      const s = fs.readFileSync(p, 'utf8');
      const prefix = (s.match(/@Controller\(\s*'([^']*)'/) || [, ''])[1];
      for (const m of s.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
        out.push({ method: m[1].toUpperCase(), path: '/' + [prefix, m[2] ?? ''].filter(Boolean).join('/'), file: path.relative(root, p) });
      }
    }
  }
}
walk(root);
console.log(JSON.stringify(out));
