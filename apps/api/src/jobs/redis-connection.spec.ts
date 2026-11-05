import IORedis from 'ioredis';
import { redisConnectionArgs } from './queue.module';

/** Decision 431 (stress test round 5 MON-16): the whole REDIS_URL reaches ioredis. */
describe('REDIS_URL', () => {
  const clientFor = (url: string | undefined) => {
    const client = new IORedis(...redisConnectionArgs(url));
    const options = client.options;
    client.disconnect();
    return options;
  };

  it('keeps the database number', () => {
    const o = clientFor('redis://localhost:6379/5');
    expect(o.db).toBe(5);
    expect(o.host).toBe('localhost');
    expect(o.port).toBe(6379);
  });

  it('keeps the username and password', () => {
    const o = clientFor('redis://worker:s3cret@redis.internal:6380/2');
    expect(o.username).toBe('worker');
    expect(o.password).toBe('s3cret');
    expect(o.db).toBe(2);
  });

  it('uses TLS for rediss://', () => {
    expect(clientFor('rediss://redis.example.com:6380').tls).toBeTruthy();
    expect(clientFor('redis://redis.example.com:6380').tls).toBeFalsy();
  });

  it('never connects up front and retries for BullMQ', () => {
    const o = clientFor(undefined);
    expect(o.lazyConnect).toBe(true);
    expect(o.maxRetriesPerRequest).toBeNull();
    expect(o.db).toBe(0);
  });
});
