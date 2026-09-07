import { TwilioVerifyService } from './twilio-verify.service';

/**
 * Regression coverage for a code-review finding on this same PR: sendOtp() used to
 * only enqueue, silently losing the fail-fast signal callers previously got when
 * Twilio wasn't configured at all. Every prior test touching TwilioVerifyService
 * (auth.service.spec.ts) mocks this class entirely, so none of them ever exercised
 * its real internals — this file is the first to.
 */
describe('TwilioVerifyService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function makeQueue() {
    return { add: jest.fn().mockResolvedValue(undefined) };
  }

  it('sendOtp() throws synchronously, without enqueueing, when Twilio is not configured', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_VERIFY_SERVICE_SID;
    const queue = makeQueue();
    const service = new TwilioVerifyService(queue as never);

    await expect(service.sendOtp('+15551234567')).rejects.toThrow(/not configured/i);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sendOtp() enqueues once Twilio is configured', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA_test';
    const queue = makeQueue();
    const service = new TwilioVerifyService(queue as never);

    await service.sendOtp('+15551234567');

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      { phone: '+15551234567' },
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
