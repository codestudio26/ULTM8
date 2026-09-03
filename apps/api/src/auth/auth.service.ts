import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { TwilioVerifyService } from './otp/twilio-verify.service';
import { LoginAttemptTracker } from './login-attempt-tracker.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasscodeResetDto } from './dto/request-passcode-reset.dto';
import { ConfirmPasscodeResetDto } from './dto/confirm-passcode-reset.dto';
import { JwtPayload, RoleGrantClaim } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly twilioVerify: TwilioVerifyService,
    private readonly jwt: JwtService,
    private readonly loginAttempts: LoginAttemptTracker,
  ) {}

  /**
   * Creates the User row immediately (Spec §8.1's screen order: registration form
   * first, OTP verification second) with phoneVerifiedAt still null, then sends the
   * OTP. Login is blocked until verifyOtp() confirms the phone.
   */
  async register(dto: RegisterDto) {
    if (dto.passcode !== dto.passcodeConfirm) {
      throw new BadRequestException('passcode and passcodeConfirm must match');
    }

    const existing = await this.prismaAuth.user.findFirst({
      where: {
        OR: [
          { email: dto.email },
          { phone: dto.phone },
          ...(dto.username ? [{ username: dto.username }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email, phone, or username already exists');
    }

    const passcodeHash = await bcrypt.hash(dto.passcode, BCRYPT_ROUNDS);
    const id = randomUUID();

    await this.prismaApp.withTenantContext(id, (tx) =>
      tx.user.create({
        data: {
          id,
          email: dto.email,
          phone: dto.phone,
          firstName: dto.firstName,
          surname: dto.surname,
          username: dto.username,
          passcodeHash,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          nationality: dto.nationality,
          language: dto.language,
          currency: dto.currency,
          address: dto.address,
        },
      }),
    );

    await this.twilioVerify.sendOtp(dto.phone);

    return {
      message: 'Registered — verification code sent. Call POST /auth/otp/verify to complete registration.',
    };
  }

  /** Re-sends an OTP — used for registration or passcode-reset retries alike. */
  async sendOtp(dto: SendOtpDto) {
    await this.twilioVerify.sendOtp(dto.phone);
    return { message: 'Verification code sent' };
  }

  /** Completes registration by confirming phone ownership. */
  async verifyOtp(dto: VerifyOtpDto) {
    const approved = await this.twilioVerify.checkOtp(dto.phone, dto.code);
    if (!approved) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const user = await this.prismaAuth.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('No registration found for this phone number');
    }

    await this.prismaApp.withTenantContext(user.id, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      }),
    );

    return { message: 'Phone verified — you can now log in.' };
  }

  /**
   * Login is email + passcode only (Decision 72). JWT claims are built from the full
   * set of currently-active RoleGrants at login time (ultm8-domain-rules §3).
   */
  async login(dto: LoginDto) {
    if (this.loginAttempts.isLocked(dto.email)) {
      throw new ForbiddenException(
        'Too many failed attempts — account temporarily locked. Try again later.',
      );
    }

    const user = await this.prismaAuth.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, passcodeHash: true, phoneVerifiedAt: true },
    });

    const passcodeMatches = user
      ? await bcrypt.compare(dto.passcode, user.passcodeHash)
      : await bcrypt.compare(dto.passcode, '$2a$12$invalidinvalidinvalidinvalidinvalidinva'); // constant-time-ish decoy

    if (!user || !passcodeMatches) {
      this.loginAttempts.recordFailure(dto.email);
      throw new UnauthorizedException('Invalid email or passcode');
    }

    if (!user.phoneVerifiedAt) {
      throw new ForbiddenException('Phone not verified — complete registration via POST /auth/otp/verify');
    }

    this.loginAttempts.recordSuccess(dto.email);

    const accessToken = await this.issueAccessToken(user.id);
    return { accessToken };
  }

  /**
   * Signs a fresh access token for `userId`, built from their full set of currently-
   * active RoleGrants — the same claims shape and freshness rule login() itself uses
   * (ultm8-domain-rules §3: "sessions/JWTs are built from the full set of currently-
   * active grants... at login/refresh time"), factored out so both share one
   * implementation rather than two copies of the signing logic drifting apart.
   *
   * Callable outside the login flow for exactly one narrow, approved case
   * (ultm8-nestjs-module §7): SchoolsService.create() re-mints the caller's own token
   * after granting them SCHOOL_OWNER_MANAGER, so their session reflects it immediately
   * instead of needing to log out and back in. `userId` must always be the caller's own
   * id in that context — this method itself does no authorization check of its own
   * (there's nothing to check: it only ever signs a token for whatever active grants
   * `userId` already, actually holds in the DB at call time, never a claim the caller
   * asked for).
   */
  async issueAccessToken(userId: string): Promise<string> {
    const { user, grants } = await this.prismaApp.withTenantContext(userId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) {
        // Shouldn't happen — userId is always the already-authenticated caller's own
        // id at every call site — but fail loudly rather than sign a token with no
        // email if it ever somehow does.
        throw new Error(`issueAccessToken: no User found for id ${userId}`);
      }
      const grants = await tx.roleGrant.findMany({
        where: { userId, revokedAt: null },
        select: { role: true, franchiseId: true, schoolId: true, branchId: true },
      });
      return { user, grants };
    });

    const claims: RoleGrantClaim[] = grants.map((g) => ({
      role: g.role,
      franchiseId: g.franchiseId,
      schoolId: g.schoolId,
      branchId: g.branchId,
    }));

    const payload: JwtPayload = { sub: userId, email: user.email, grants: claims };
    return this.jwt.sign(payload);
  }

  /**
   * Always responds success regardless of whether the phone is registered, to avoid
   * account enumeration — standard security hygiene, not a new business rule.
   */
  async requestPasscodeReset(dto: RequestPasscodeResetDto) {
    const user = await this.prismaAuth.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true },
    });
    if (user) {
      await this.twilioVerify.sendOtp(dto.phone);
    }
    return { message: 'If this phone number is registered, a verification code has been sent.' };
  }

  async confirmPasscodeReset(dto: ConfirmPasscodeResetDto) {
    const approved = await this.twilioVerify.checkOtp(dto.phone, dto.code);
    if (!approved) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    const user = await this.prismaAuth.user.findUnique({
      where: { phone: dto.phone },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('No account found for this phone number');
    }

    const passcodeHash = await bcrypt.hash(dto.newPasscode, BCRYPT_ROUNDS);
    await this.prismaApp.withTenantContext(user.id, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { passcodeHash } }),
    );
    this.loginAttempts.recordSuccess(dto.phone);

    return { message: 'Passcode updated — you can now log in with your new passcode.' };
  }
}
