// Shared setup for the round 4 scripts: the round 1 helpers (db, pool, token,
// grant), the round 4 cast, a `call` that also records response sizes, and the
// round 3 PASS/FAIL bookkeeping.
//   CAST  path to cast.json (default ./cast.json, written by world.mjs)
import fs from 'fs';
import { createRequire } from 'module';
export { db, pool, grant, randomUUID, Queue } from '../booking-schedule/lib.mjs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { JwtService } = require('@nestjs/jwt');
export const { QueueEvents } = require('bullmq');

export const API = process.env.API || 'http://localhost:3200/v1';
export const cast = JSON.parse(fs.readFileSync(process.env.CAST || new URL('./cast.json', import.meta.url)));
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
/** A token as the real sign-in builds it, with the roles-changed stamp (Decision 361). */
export const tokenRca = (user, grants, rca = Date.now()) => jwt.sign({ sub: user.id, email: user.email, grants, rca }, { expiresIn: '6h' });

export const stats = {};
function rec(label, ms, status, bytes) {
  const s = (stats[label] ||= { n: 0, ms: [], codes: {}, bytes: [] });
  s.n++; s.ms.push(ms); s.codes[status] = (s.codes[status] || 0) + 1; s.bytes.push(bytes);
}
export function report(labels, file) {
  const rows = [];
  for (const [label, s] of Object.entries(stats)) {
    if (labels && !labels.some((l) => label.startsWith(l))) continue;
    const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))] | 0;
    const a = s.ms.slice().sort((x, y) => x - y); const b = s.bytes.slice().sort((x, y) => x - y);
    rows.push({ label, n: s.n, p50: q(a, 0.5), p95: q(a, 0.95), p99: q(a, 0.99), max: a[a.length - 1] | 0, kbMax: Math.round(b[b.length - 1] / 1024), codes: JSON.stringify(s.codes) });
  }
  console.table(rows);
  if (file) fs.writeFileSync(new URL(file, import.meta.url), JSON.stringify(rows, null, 1));
  return rows;
}

export async function call(label, method, path, tok, body, headers = {}) {
  const t0 = performance.now();
  let res, text = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      text = await res.text();
      break;
    } catch (e) {
      if (attempt === 5) { rec(label, performance.now() - t0, 'NETERR', 0); return { status: 0, body: String(e) }; }
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  rec(label, performance.now() - t0, res.status, Buffer.byteLength(text));
  return { status: res.status, body: json, bytes: Buffer.byteLength(text) };
}

/** PASS/FAIL bookkeeping, written to <name>-result.json next to the script. */
export function checks(name) {
  const results = [];
  const ok = (id, pass, detail) => { results.push({ id, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? ' — ' + detail : ''}`); };
  const save = () => { fs.writeFileSync(new URL(`./${name}-result.json`, import.meta.url), JSON.stringify(results, null, 1)); const f = results.filter((r) => !r.pass).length; console.log(`\n${name}: ${results.length - f}/${results.length} passed`); return results; };
  return { ok, save, results };
}
export const codes = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
export const bySize = (size) => cast.schools.filter((s) => s.size === size);
export const live = (st) => ['sub', 'pack', 'pack10', 'week', 'trial'].includes(st.kind);
