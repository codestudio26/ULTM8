import { AuthService } from './auth.service';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let prismaAuth: any;
  let prismaApp: any;
  let twilio: any;
  let jwt: any;
  let loginAttempts: any;

  beforeEach(() => {
    prismaAuth = {
      user: { findFirst: jest.fn(), findUnique: jest.fn() },
      // Backs issueRefreshToken()'s create() (login()/refresh()) and
      // confirmPasscodeReset()'s mass-revoke updateMany() — both now called
      // unconditionally on their respective success paths.
      refreshToken: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    };
    prismaApp = {
      withTenantContext: jest.fn((_id: string, fn: any) =>
        fn({
          // findUnique backs AuthService.issueAccessToken()'s own email lookup
          // (factored out of login(), also used by SchoolsService.create()'s
          // token-remint) — mocked to resolve the same email login()'s own
          // prismaAuth mock already uses below, so the two stay consistent.
          user: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ email: 'a@example.test' }) },
          roleGrant: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      ),
    };
    twilio = { sendOtp: jest.fn(), checkOtp: jest.fn() };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    loginAttempts = { isLocked: jest.fn().mockReturnValue(false), recordFailure: jest.fn(), recordSuccess: jest.fn() };

    service = new AuthService(prismaApp, prismaAuth, twilio, jwt, loginAttempts);
  });

  describe('register', () => {
    const dto = {
      email: 'a@example.test',
      phone: '+15551234567',
      firstName: 'A',
      surname: 'B',
      passcode: '123456',
      passcodeConfirm: '123456',
      dateOfBirth: '2000-01-01',
    } as any;

    it('rejects mismatched passcode/passcodeConfirm', async () => {
      await expect(service.register({ ...dto, passcodeConfirm: '654321' })).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate email/phone/username', async () => {
      prismaAuth.user.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('creates the user and sends an OTP on success', async () => {
      prismaAuth.user.findFirst.mockResolvedValue(null);
      const result = await service.register(dto);
      expect(twilio.sendOtp).toHaveBeenCalledWith(dto.phone);
      expect(result.message).toMatch(/verification code sent/i);
    });
  });

  describe('login', () => {
    it('rejects when locked out — after paying the DB lookup, but before recordFailure', async () => {
      loginAttempts.isLocked.mockReturnValue(true);
      prismaAuth.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.test', passcodeHash: 'x', phoneVerifiedAt: new Date() });
      await expect(service.login({ email: 'a@example.test', passcode: '123456' })).rejects.toThrow(ForbiddenException);
      // The DB lookup now runs before the lock check (timing-gap fix) — confirm it
      // actually happened, not skipped.
      expect(prismaAuth.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'a@example.test' },
        select: { id: true, email: true, passcodeHash: true, phoneVerifiedAt: true },
      });
      // The lock check must still reject before ever reaching the compare-and-record
      // step — recordFailure() must not fire for an already-locked account, same as
      // before the reorder.
      expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
    });

    it('rejects an unknown email without revealing that it is unknown', async () => {
      prismaAuth.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'nope@example.test', passcode: '123456' })).rejects.toThrow(
        UnauthorizedException,
      );
      expect(loginAttempts.recordFailure).toHaveBeenCalled();
    });

    it('rejects a wrong passcode and records the failure', async () => {
      const hash = await bcrypt.hash('123456', 4);
      prismaAuth.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.test', passcodeHash: hash, phoneVerifiedAt: new Date() });
      await expect(service.login({ email: 'a@example.test', passcode: '000000' })).rejects.toThrow(UnauthorizedException);
      expect(loginAttempts.recordFailure).toHaveBeenCalledWith('a@example.test');
    });

    it('blocks login until the phone is verified', async () => {
      const hash = await bcrypt.hash('123456', 4);
      prismaAuth.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.test', passcodeHash: hash, phoneVerifiedAt: null });
      await expect(service.login({ email: 'a@example.test', passcode: '123456' })).rejects.toThrow(ForbiddenException);
    });

    it('returns a signed access token built from active RoleGrants on success', async () => {
      const hash = await bcrypt.hash('123456', 4);
      prismaAuth.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.test', passcodeHash: hash, phoneVerifiedAt: new Date() });
      const result = await service.login({ email: 'a@example.test', passcode: '123456' });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);
      expect(prismaAuth.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
      );
      expect(loginAttempts.recordSuccess).toHaveBeenCalledWith('a@example.test');
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1', email: 'a@example.test', grants: [] }));
    });
  });

  describe('refresh', () => {
    it('rejects an unknown token', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh({ refreshToken: 'bogus' })).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.refresh({ refreshToken: 'stale' })).rejects.toThrow(UnauthorizedException);
    });

    it('REUSE DETECTION: a ROTATED-OUT token presented a second time revokes every other active token for that User and rejects', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', revokedAt: new Date(), rotatedOut: true, expiresAt: new Date(Date.now() + 1000),
      });
      await expect(service.refresh({ refreshToken: 'replayed' })).rejects.toThrow(UnauthorizedException);
      expect(prismaAuth.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('a revoked-but-NOT-rotated token (e.g. logged out, or caught by the passcode-reset mass-revoke) is an ordinary 401 — NOT a reuse signal, no mass revoke of sibling sessions', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', revokedAt: new Date(), rotatedOut: false, expiresAt: new Date(Date.now() + 1000),
      });
      await expect(service.refresh({ refreshToken: 'logged-out' })).rejects.toThrow(UnauthorizedException);
      expect(prismaAuth.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rotates a valid token: revokes the presented one (and marks it rotatedOut), mints a fresh pair', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', revokedAt: null, rotatedOut: false, expiresAt: new Date(Date.now() + 1000),
      });
      prismaAuth.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.refresh({ refreshToken: 'valid' });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
      expect(prismaAuth.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt1', revokedAt: null },
        data: { revokedAt: expect.any(Date), rotatedOut: true },
      });
    });

    it('a losing concurrent rotation attempt (updateMany count 0) is rejected, not treated as success', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', revokedAt: null, rotatedOut: false, expiresAt: new Date(Date.now() + 1000),
      });
      prismaAuth.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.refresh({ refreshToken: 'valid' })).rejects.toThrow(UnauthorizedException);
    });

    it('FOUND ON REVIEW: a losing concurrent rotation attempt triggers the same mass-revoke reuse-detection as a sequential replay, not a silent no-op that merely claims it did', async () => {
      prismaAuth.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', revokedAt: null, rotatedOut: false, expiresAt: new Date(Date.now() + 1000),
      });
      // First updateMany call is the rotation attempt itself (loses the
      // race); the second is the mass-revoke this test proves now actually
      // runs, not just a message claiming it did.
      prismaAuth.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
      prismaAuth.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(service.refresh({ refreshToken: 'valid' })).rejects.toThrow(UnauthorizedException);
      expect(prismaAuth.refreshToken.updateMany).toHaveBeenCalledTimes(2);
      expect(prismaAuth.refreshToken.updateMany).toHaveBeenNthCalledWith(2, {
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('logout', () => {
    it('revokes exactly the presented token, nothing else', async () => {
      prismaAuth.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.logout({ refreshToken: 'mine' });
      expect(result.message).toBe('Logged out');
      expect(prismaAuth.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }),
      );
    });
  });

  describe('confirmPasscodeReset', () => {
    it('clears the lockout by the user\'s email, not the request\'s phone (LoginAttemptTracker is keyed by email everywhere else)', async () => {
      twilio.checkOtp.mockResolvedValue(true);
      prismaAuth.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@example.test' });
      await service.confirmPasscodeReset({
        phone: '+15551234567',
        code: '123456',
        newPasscode: '654321',
      } as any);
      expect(loginAttempts.recordSuccess).toHaveBeenCalledWith('a@example.test');
      expect(loginAttempts.recordSuccess).not.toHaveBeenCalledWith('+15551234567');
      // A passcode reset is frequently a compromise-recovery action — every
      // refresh token issued under the OLD passcode must not survive it.
      expect(prismaAuth.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
