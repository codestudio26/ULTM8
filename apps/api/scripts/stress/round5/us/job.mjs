// Helper: run one background job through its BullMQ queue, as the scheduler would.
//   node job.mjs <queue> [jobName]
import { Queue, QueueEvents } from '../../round4/common.mjs';
const [name, jobName = 'run'] = process.argv.slice(2);
const q = new Queue(name, { connection: { url: process.env.REDIS_URL } });
const ev = new QueueEvents(name, { connection: { url: process.env.REDIS_URL } });
await ev.waitUntilReady();
const t0 = Date.now();
const job = await q.add(jobName, {});
try { const r = await job.waitUntilFinished(ev, 600e3); console.log('finished', (Date.now() - t0) / 1000, 's', JSON.stringify(r)); }
catch (e) { console.log('FAILED', (Date.now() - t0) / 1000, 's:', e.message); }
await q.close(); await ev.close(); process.exit(0);
