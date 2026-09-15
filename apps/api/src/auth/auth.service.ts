import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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

/**
 * A real bcrypt hash (not an eyeballed string) of a value nobody will ever type as a
 * passcode — compared against on every login attempt for an email that doesn't exist,
 * so a nonexistent-user rejection takes roughly the same time as a wrong-passcode
 * rejection for a real user, rather than short-circuiting instantly and leaking which
 * emails are registered via timing. Generated once via
 * `bcrypt.hashSync('a value that will never be typed as a real passcode', 12)` and
 * hardcoded here — a hand-typed placeholder previously used here
 * (`$2a$12$invalidinvalidinvalidinvalidinvalidinva`) was the wrong length for a real
 * bcrypt hash (39 chars after the cost prefix instead of the required 22-char salt +
 * 31-char hash = 53), which risked bcryptjs's malformed-input handling itself taking a
 * different amount of time than a well-formed comparison — this hash is real output
 * from the library, guaranteed correct shape.
 */
const DECOY_PASSCODE_HASH = '$2a$12$KC.JM0GG3LUNutCFB3SKbu1poEdSC6djHNvDgq3kxcU7vw5f8Z3fq';

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
   *
   * The DB lookup runs BEFORE the lockout check (not after, as this originally read) —
   * deliberately, to narrow a timing side-channel: a locked account used to be
   * rejected instantly (no DB round-trip, no bcrypt), while every other outcome (wrong
   * email, wrong passcode, unlocked account) always paid the DB round-trip, making
   * "instant rejection" itself an observable signal that the account exists and is
   * locked. Making a locked account also pay the DB round-trip narrows that gap at
   * near-zero cost. Deliberately NOT running bcrypt for a locked account too, even
   * though that would narrow the gap further — that's real CPU spent on an outcome
   * that's already determined regardless of passcode correctness, not an oversight.
   * This is a calibrated narrowing, not a claim that the timing channel is fully
   * closed — the lockout system itself is already flagged elsewhere (Spec §11.5,
   * LoginAttemptTracker's own header comment) as a stopgap needing a real
   * Architect-level redesign; full constant-time behavior belongs in that redesign,
   * not bolted on here piecemeal.
   *
   * The lock check still runs, and still rejects, BEFORE the compare-and-record step
   * below — recordFailure() never fires for an already-locked account, same as before
   * this reorder; only the DB-lookup timing changed, not this control flow.
   */
  async login(dto: LoginDto) {
    const user = await this.prismaAuth.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, passcodeHash: true, phoneVerifiedAt: true },
    });

    if (this.loginAttempts.isLocked(dto.email)) {
      throw new ForbiddenException(
        'Too many failed attempts — account temporarily locked. Try again later.',
      );
    }

    const passcodeMatches = user
      ? await bcrypt.compare(dto.passcode, user.passcodeHash)
      : await bcrypt.compare(dto.passcode, DECOY_PASSCODE_HASH);

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
   * Phase 43 (Decision 102 — PlatformAdminModule Support-tier impersonation is
   * read-only, resolved directly with the user). Mints a genuine tenant-realm
   * JwtPayload for `targetUserId` — same shape, same JWT_ACCESS_SECRET, same
   * JwtStrategy that verifies every ordinary tenant login token — so every
   * existing tenant endpoint (GET /bookings/me, GET /waivers/me, ...) "just
   * works" unmodified for a Support staffer impersonating that user, seeing the
   * SAME RoleGrant claims the real user's own token would carry (a genuine
   * mirror of what they see, not a stripped-down admin view). The one addition,
   * `impersonation`, is what JwtStrategy.validate() checks to reject any
   * non-read request on this token — see that file's own comment.
   *
   * Deliberately mirrors issueAccessToken()'s own load-email-and-grants shape
   * rather than calling it directly — this one always takes a caller-supplied
   * short `ttlSeconds` (Platform Admin's own "time-boxed" requirement,
   * ultm8-tenant-isolation §3), never the ordinary 15-minute JWT_ACCESS_TTL
   * default issueAccessToken() relies on, and needs the extra `impersonation`
   * claim issueAccessToken() must never set.
   *
   * `targetUserId` not existing is a genuine 404, not the "shouldn't happen"
   * internal-error case issueAccessToken() assumes for its own always-already-
   * authenticated caller — a Platform Admin can supply any id here, including a
   * typo or a since-deleted account, so this checks and reports it as a normal
   * client error rather than throwing a bare Error.
   */
  async issueImpersonationToken(
    targetUserId: string,
    adminUserId: string,
    ttlSeconds: number,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const { user, grants } = await this.prismaApp.withTenantContext(targetUserId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: targetUserId }, select: { email: true } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const grants = await tx.roleGrant.findMany({
        where: { userId: targetUserId, revokedAt: null },
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

    const payload: JwtPayload = {
      sub: targetUserId,
      email: user.email,
      grants: claims,
      impersonation: { adminUserId, startedAt: new Date().toISOString() },
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: ttlSeconds });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return { accessToken, expiresAt };
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
      select: { id: true, email: true },
    });
    if (!user) {
      throw new BadRequestException('No account found for this phone number');
    }

    const passcodeHash = await bcrypt.hash(dto.newPasscode, BCRYPT_ROUNDS);
    await this.prismaApp.withTenantContext(user.id, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { passcodeHash } }),
    );
    // LoginAttemptTracker is keyed by email everywhere else (isLocked/recordFailure in
    // login() both use email) — this previously called recordSuccess(dto.phone),
    // which was a silent no-op against a different key and never actually cleared the
    // lockout a successful passcode reset is clearly meant to clear.
    this.loginAttempts.recordSuccess(user.email);

    return { message: 'Passcode updated — you can now log in with your new passcode.' };
  }
}
