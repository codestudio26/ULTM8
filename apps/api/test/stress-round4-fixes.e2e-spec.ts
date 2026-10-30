/**
 * Regression gate for the stress test of 30 Oct 2026
 * (docs/handover/STRESS-TEST-ROUND4.md). Each block pins one finding:
 *
 * - N1: every notice shares one queue, taken first in, first out, so a
 *   waitlist seat offer (60 minutes to claim) waited behind ~270k broadcast
 *   and waiver-request jobs. Bulk notices now carry a BullMQ priority; this
 *   checks BullMQ really serves a job with no priority before them.
 * - M1: amounts sent to Stripe in each currency's own smallest unit (the
 *   conversion itself is unit-tested in src/payments/stripe-amount.spec.ts).
 *
 * Requires REDIS_URL.
 */
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import { BULK_NOTIFICATION_PRIORITY } from '../src/jobs/notification-fanout.types';
import { toStripeAmount } from '../src/payments/stripe-amount';

const REDIS_URL = process.env.REDIS_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('N1: urgent notices are not stuck behind bulk ones', () => {
  const url = new URL(REDIS_URL ?? 'redis://localhost:6379');
  const connection = { host: url.hostname, port: Number(url.port || 6379), password: url.password || undefined };
  const name = `stress-round4-n1-${randomUUID()}`;
  const queue = new Queue(name, { connection });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('a seat offer queued after 50 bulk notices is handled first', async () => {
    await queue.addBulk(Array.from({ length: 50 }, (_, i) => ({ name: 'notify', data: { kind: 'broadcast', i }, opts: { priority: BULK_NOTIFICATION_PRIORITY } })));
    await queue.add('notify', { kind: 'seat-offer' });
    const order: string[] = [];
    await new Promise<void>((resolve) => {
      const worker = new Worker(
        name,
        async (job) => {
          order.push(job.data.kind);
          if (order.length === 51) void worker.close().then(resolve);
        },
        { connection },
      );
    });
    expect(order[0]).toBe('seat-offer');
  });
});

describe('M1: a yen price is not charged 100 times over', () => {
  it('1,000 JPY (stored as 100000) goes to Stripe as 1000', () => {
    expect(toStripeAmount(100000, 'jpy')).toBe(1000);
  });
});
