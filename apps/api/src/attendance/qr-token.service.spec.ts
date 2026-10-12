import { randomUUID } from 'crypto';
import { QrTokenService } from './qr-token.service';

/**
 * Decision 235's new deriveClassCheckInCode()/verifyClassCheckInCode() are
 * non-trivial (HMAC-over-time-bucket, one-bucket grace window, fail-loud on
 * an unconfigured secret) and have no e2e coverage of the boundary behavior
 * itself — attendance.e2e-spec.ts only exercises success/failure through the
 * HTTP layer at "now", never across a bucket rotation.
 */
describe('QrTokenService — Decision 235 check-in code derivation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.QR_CLASS_TOKEN_SECRET = 'test-class-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('derives a 6-digit numeric code that verifies for the same Class at the same time', () => {
    const service = new QrTokenService();
    const classId = randomUUID();

    const { code } = service.deriveClassCheckInCode(classId);

    expect(code).toMatch(/^\d{6}$/);
    expect(service.verifyClassCheckInCode(classId, code)).toBe(true);
  });

  it('rejects a code minted for a different Class', () => {
    const service = new QrTokenService();
    const { code } = service.deriveClassCheckInCode(randomUUID());

    expect(service.verifyClassCheckInCode(randomUUID(), code)).toBe(false);
  });

  it('rejects an incorrect code', () => {
    const service = new QrTokenService();
    const classId = randomUUID();
    const { code } = service.deriveClassCheckInCode(classId);
    const wrongCode = code === '000000' ? '111111' : '000000';

    expect(service.verifyClassCheckInCode(classId, wrongCode)).toBe(false);
  });

  it('accepts the immediately preceding bucket\'s code (one-bucket grace window)', () => {
    const ttlMs = Number(process.env.QR_ATTENDANCE_TOKEN_TTL_SECONDS ?? 20) * 1000;
    const bucketStart = Math.floor(Date.now() / ttlMs) * ttlMs;
    jest.spyOn(Date, 'now').mockReturnValue(bucketStart);

    const service = new QrTokenService();
    const classId = randomUUID();
    const { code } = service.deriveClassCheckInCode(classId);

    jest.spyOn(Date, 'now').mockReturnValue(bucketStart + ttlMs);
    expect(service.verifyClassCheckInCode(classId, code)).toBe(true);
  });

  it('rejects a code once it is more than one bucket old', () => {
    const ttlMs = Number(process.env.QR_ATTENDANCE_TOKEN_TTL_SECONDS ?? 20) * 1000;
    const bucketStart = Math.floor(Date.now() / ttlMs) * ttlMs;
    jest.spyOn(Date, 'now').mockReturnValue(bucketStart);

    const service = new QrTokenService();
    const classId = randomUUID();
    const { code } = service.deriveClassCheckInCode(classId);

    jest.spyOn(Date, 'now').mockReturnValue(bucketStart + 2 * ttlMs);
    expect(service.verifyClassCheckInCode(classId, code)).toBe(false);
  });

  it('fails loudly, not with a guessable deterministic code, when QR_CLASS_TOKEN_SECRET is unset', () => {
    delete process.env.QR_CLASS_TOKEN_SECRET;
    const service = new QrTokenService();

    expect(() => service.deriveClassCheckInCode(randomUUID())).toThrow(/QR_CLASS_TOKEN_SECRET is not set/);
  });
});
