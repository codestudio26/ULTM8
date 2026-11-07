// Round 6 T: run the API's own daily jobs at a chosen moment ("what the
// scheduler would do on that day"), in a separate Nest process built from
// dist/ (a second API instance: its BullMQ workers run too).
//
//   node --require ../../../rehearsal/use-fakes.cjs clock.cjs plan.json [startIndex]
//
// plan.json: [{ "at": "2027-02-28T05:30:00Z", "jobs": ["charge-recurring", ...] }, ...]
// Each step: the process clock is set to `at` (Date is replaced, so every
// `new Date()` in this process reads the simulated time; Postgres' own now()
// and Prisma's createdAt defaults stay real), then each job's processor runs
// directly (run(now) / sweep(now) where the processor has one, else process()).
// One JSON line per job is appended to $T_OUT/clock.jsonl as it finishes, so a
// killed run can be resumed from the last step done (startIndex).
//
// Shortcut named: Date is faked in this process only. A job that compares with
// Postgres now() would not see the simulated time; this harness says so where
// it matters.
const path = require('path');
const fs = require('fs');

const RealDate = Date;
let offset = 0;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
  static now() { return RealDate.now() + offset; }
}
global.Date = FakeDate;
const setNow = (iso) => { offset = new RealDate(iso).getTime() - RealDate.now(); };

const API_DIR = path.resolve(__dirname, '../../../..');
const OUT = process.env.T_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, process.env.CLOCK_LOG || 'clock.jsonl');

const JOBS = {
  'charge-recurring': ['jobs/charge-recurring.processor', 'ChargeRecurringProcessor', 'run'],
  'charge-auto-pay': ['jobs/charge-auto-pay.processor', 'ChargeAutoPayProcessor', 'run'],
  'charge-due-reminder': ['jobs/charge-due-reminder.processor', 'ChargeDueReminderProcessor', 'run'],
  'charge-overdue-notice': ['jobs/charge-overdue-notice.processor', 'ChargeOverdueNoticeProcessor', 'run'],
  'late-fee': ['jobs/late-fee.processor', 'LateFeeProcessor', 'run'],
  'plan-switch': ['jobs/plan-switch.processor', 'PlanSwitchProcessor', 'run'],
  'plan-waitlist': ['jobs/plan-waitlist.processor', 'PlanWaitlistProcessor', 'run'],
  'membership-expiry-sweep': ['jobs/membership-expiry-sweep.processor', 'MembershipExpirySweepProcessor', 'process'],
  'membership-expiry-reminder': ['jobs/membership-expiry-reminder.processor', 'MembershipExpiryReminderProcessor', 'run'],
  'membership-ending-report': ['jobs/membership-ending-report.processor', 'MembershipEndingReportProcessor', 'run'],
  'account-erasure': ['jobs/account-erasure.processor', 'AccountErasureProcessor', 'sweep'],
  'waiver-renewal-sweep': ['jobs/waiver-renewal-sweep.processor', 'WaiverRenewalSweepProcessor', 'sweep'],
  'student-absence-alert': ['jobs/student-absence-alert.processor', 'StudentAbsenceAlertProcessor', 'run'],
  'notification-unsnooze-sweep': ['jobs/notification-unsnooze-sweep.processor', 'NotificationUnsnoozeSweepProcessor', 'process'],
};

async function main() {
  const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const start = Number(process.argv[3] || 0);
  const { NestFactory } = require(path.join(API_DIR, 'node_modules/@nestjs/core'));
  const { AppModule } = require(path.join(API_DIR, 'dist/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: process.env.CLOCK_QUIET ? ['error'] : ['error', 'warn', 'log'] });
  const procs = {};
  for (const [name, [file, cls]] of Object.entries(JOBS)) {
    try { procs[name] = app.get(require(path.join(API_DIR, 'dist', file))[cls], { strict: false }); } catch (e) { console.error('no processor', name, e.message); }
  }
  // Which simulated step made each charge (createdAt is real time; Prisma sets it).
  const { PrismaClient } = require(path.join(API_DIR, 'node_modules/@prisma/client'));
  const pc = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  let realMark = new RealDate(RealDate.now() - 1);
  for (let k = start; k < plan.length; k++) {
    const stepPlan = plan[k];
    setNow(stepPlan.at);
    // Service calls at the simulated time, as a person would make them then
    // (e.g. staff ending a freeze early): { file, cls, method, args }.
    for (const c of stepPlan.calls || []) {
      let result, error;
      try { result = await app.get(require(path.join(API_DIR, 'dist', c.file))[c.cls], { strict: false })[c.method](...c.args); } catch (e) { error = String(e && e.message || e); }
      fs.appendFileSync(LOG, JSON.stringify({ k, at: stepPlan.at, call: `${c.cls}.${c.method}`, tag: c.tag, result: summarise(result), error }) + '\n');
    }
    for (const name of stepPlan.jobs || []) {
      const p = procs[name];
      const method = JOBS[name][2];
      const t0 = RealDate.now();
      let result, error;
      try {
        result = method === 'process' ? await p.process({ data: {} }) : await p[method](new Date());
      } catch (e) { error = String(e && e.message || e); }
      const row = { k, at: stepPlan.at, job: name, ms: RealDate.now() - t0, result: summarise(result), error };
      fs.appendFileSync(LOG, JSON.stringify(row) + '\n');
      if (!process.env.CLOCK_QUIET) console.log(JSON.stringify(row));
      const made = await pc.charge.findMany({ where: { createdAt: { gt: realMark } }, select: { id: true, createdAt: true } });
      if (made.length) {
        fs.appendFileSync(path.join(OUT, 'charge-sim.jsonl'), made.map((c) => JSON.stringify({ id: c.id, simAt: stepPlan.at, job: name })).join('\n') + '\n');
        realMark = made.reduce((m, c) => (c.createdAt > m ? c.createdAt : m), realMark);
      }
    }
  }
  await pc.$disconnect();
  await app.close();
  process.exit(0);
}
function summarise(r) {
  if (!r || typeof r !== 'object') return r;
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = Array.isArray(v) ? v.length : v;
  return o;
}
main().catch((e) => { console.error(e); process.exit(1); });
