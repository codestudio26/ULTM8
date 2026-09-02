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
    prismaAuth = { user: { findFirst: jest.fn(), findUnique: jest.fn() } };
    prismaApp = { withTenantContext: jest.fn((_id: string, fn: any) => fn({ user: { create: jest.fn(), update: jest.fn() }, roleGrant: { findMany: jest.fn().mockResolvedValue([]) } })) };
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
    it('rejects when locked out', async () => {
      loginAttempts.isLocked.mockReturnValue(true);
      await expect(service.login({ email: 'a@example.test', passcode: '123456' })).rejects.toThrow(ForbiddenException);
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
      expect(loginAttempts.recordSuccess).toHaveBeenCalledWith('a@example.test');
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1', email: 'a@example.test', grants: [] }));
    });
  });
});
