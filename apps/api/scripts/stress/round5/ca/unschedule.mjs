import { createRequire } from 'module';
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { Queue } = require('bullmq');
const { execSync } = await import('child_process');
const names = [...new Set(execSync('redis-cli -p 6391 --scan --pattern "bull:*:repeat*"').toString().split('\n').filter(Boolean).map((k) => k.split(':')[1]))];
for (const n of names) {
  const q = new Queue(n, { connection: { url: 'redis://localhost:6391' } });
  const reps = await q.getRepeatableJobs();
  for (const r of reps) await q.removeRepeatableByKey(r.key);
  const sch = q.getJobSchedulers ? await q.getJobSchedulers() : [];
  for (const s of sch) await q.removeJobScheduler(s.key || s.id);
  await q.drain(true).catch(() => {});
  console.log(n, reps.length, sch.length);
  await q.close();
}
