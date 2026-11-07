// Round 6 T: runs a clock plan and kills it (SIGKILL, only the process this
// script started) at random moments, then restarts it from the step it was
// in, as a crashed worker restarted by the platform would re-run the job.
//   node killer.mjs PLAN KILLS [minSec maxSec]
// Each restart re-runs the step that was cut, so every job in it runs again.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OUT } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [plan, kills = '8', minS = '4', maxS = '25'] = process.argv.slice(2);
const LOG = path.join(OUT, process.env.CLOCK_LOG || 'clock.jsonl');
const steps = JSON.parse(fs.readFileSync(plan, 'utf8')).length;
const lastK = () => {
  if (!fs.existsSync(LOG)) return -1;
  const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) { try { const r = JSON.parse(lines[i]); if (r.plan === plan || r.k !== undefined) return r.k; } catch {} }
  return -1;
};
const startK = Number(process.env.START_K ?? 0);
let from = startK;
let killed = 0;
const killLog = path.join(OUT, 'kills.jsonl');
for (;;) {
  const child = spawn(process.execPath, ['--require', path.join(here, '../../../rehearsal/use-fakes.cjs'), path.join(here, 'clock.cjs'), plan, String(from)], {
    env: { ...process.env, CLOCK_QUIET: '1', REHEARSAL_R2_PORT: String(12126 + (killed % 3)) }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const done = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })));
  let result;
  if (killed < Number(kills)) {
    const wait = (Number(minS) + Math.random() * (Number(maxS) - Number(minS))) * 1000;
    result = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), wait))]);
    if (!result) {
      child.kill('SIGKILL');
      await done;
      killed++;
      const k = lastK();
      fs.appendFileSync(killLog, JSON.stringify({ at: new Date().toISOString(), pid: child.pid, afterSec: Math.round(wait / 1000), lastStepLogged: k }) + '\n');
      console.log(`killed ${child.pid} after ${Math.round(wait / 1000)}s; last step logged ${k}; restarting at ${Math.max(k, from)}`);
      from = Math.max(k, from); // re-run the step that was cut
      continue;
    }
  } else result = await done;
  console.log('clock exited', result, 'last step', lastK(), 'of', steps - 1);
  break;
}
