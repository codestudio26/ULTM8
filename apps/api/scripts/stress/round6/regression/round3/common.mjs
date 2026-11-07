// Shared setup for the round 3 attack scripts. Reuses the round 1 helpers and cast.
//   CAST     path to cast.json (default ../booking-schedule/cast.json)
//   SCHOOLS  which cast schools this script may change, e.g. "14-17" (each script has its own default)
import fs from 'fs';
export * from '../booking-schedule/lib.mjs';

export const cast = JSON.parse(fs.readFileSync(process.env.CAST || new URL('../booking-schedule/cast.json', import.meta.url)));

/** The schools this script may change: SCHOOLS="a-b" or "a,b,c", else `fallback`. Indexes past the cast wrap around. */
export function pick(fallback) {
  const spec = process.env.SCHOOLS || fallback;
  const idx = spec.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(spec.split('-').map(Number)) : spec.split(',').map(Number);
  return idx.map((i) => cast.schools[i % cast.schools.length]);
}

/** PASS/FAIL bookkeeping, written to <name>-result.json next to the script. */
export function checks(name) {
  const results = [];
  const ok = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}${detail ? ' — ' + detail : ''}`); };
  const save = () => { fs.writeFileSync(new URL(`./${name}-result.json`, import.meta.url), JSON.stringify(results, null, 1)); const f = results.filter((r) => !r.pass).length; console.log(`\n${name}: ${results.length - f}/${results.length} passed`); };
  return { ok, save, results };
}
export const codes = (rs) => rs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
