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
import { randomUUID, randomBytes, createHash } from 'crypto';
import { Prisma } from '@prisma/client';
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
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtPayload, RoleGrantClaim } from './interfaces/jwt-payload.interface';

const BCRYPT_ROUNDS = 12;

// ultm8-nestjs-module §7's own confirmed gap, now built. 32 random bytes (256
// bits) — the token's entropy is what resists guessing, not a slow hash (see
// RefreshToken's own Prisma model comment for why tokenHash is plain SHA-256,
// not bcrypt). Default 30 days: Developer-level choice, flagged for Architect
// review same as every other *_TTL constant in this codebase; a rotated token
// always gets a fresh 30-day window from its own issuance time, so a client
// that refreshes at least once a month never sees a forced re-login, while an
// abandoned session's blast radius is still bounded.
const REFRESH_TOKEN_BYTES = 32;
// FOUND ON REVIEW: `Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30)` only
// falls back to 30 when the env var is UNSET — an accidentally-blank value
// (`REFRESH_TOKEN_TTL_DAYS=`) is present-but-empty, so `?? 30` never
// triggers, and `Number('')` is 0, not NaN, silently issuing every refresh
// token already-expired at creation. Validated explicitly instead of trusted
// to the nullish-coalescing default.
const parsedRefreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS);
const REFRESH_TOKEN_TTL_DAYS = Number.isFinite(parsedRefreshTokenTtlDays) && parsedRefreshTokenTtlDays > 0 ? parsedRefreshTokenTtlDays : 30;

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

    // FOUND ON REVIEW: these two are independent — different tables, different
    // connections (prismaApp vs. prismaAuth) — so there's no reason to pay the
    // sum of both round-trips in sequence instead of the slower of the two.
    const [accessToken, refreshToken] = await Promise.all([this.issueAccessToken(user.id), this.issueRefreshToken(user.id)]);
    return { accessToken, refreshToken };
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

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mints and persists a new RefreshToken row, returning the raw token (the
   * only time it's ever available in the clear — only tokenHash is stored).
   * Runs via `prismaAuth` (ultm8_auth role), not `prismaApp.withTenantContext`
   * — this is credential-realm bookkeeping tied to a userId we already trust
   * (just-verified login, or a refresh() call that already re-validated the
   * presented token), not a tenant-RLS-scoped read/write, so there's no
   * app.current_user_id to set and no reason to route it through that path.
   */
  private async issueRefreshToken(userId: string, db: Pick<Prisma.TransactionClient, 'refreshToken'> = this.prismaAuth): Promise<string> {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    await db.refreshToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: this.hashRefreshToken(token),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return token;
  }

  /**
   * Revokes every still-active RefreshToken for `userId` — the shared
   * implementation behind both reuse-detection's "burn the whole session
   * family" reaction (refresh(), two call sites) and confirmPasscodeReset()'s
   * own compromise-recovery revoke, so the two can't silently drift apart.
   * Deliberately does NOT set `rotatedOut` — these rows were never
   * themselves rotated, only swept as a precaution; see that flag's own
   * model comment for why the distinction matters.
   */
  private async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.prismaAuth.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /**
   * Closes ultm8-nestjs-module §7's own confirmed gap — the first real
   * implementation of Spec §8.3's refresh token. Exchanges a still-valid,
   * not-yet-revoked, not-yet-expired RefreshToken for a brand-new
   * accessToken + refreshToken pair; the presented token is revoked in the
   * same step (rotation), never reused.
   *
   * REUSE DETECTION (the standard OWASP-documented response to a replayed
   * refresh token): a presented token that hashes to a row found but already
   * revoked BY A PRIOR ROTATION (`rotatedOut`, RefreshToken's own model
   * comment) is treated as a compromise signal — an attacker replaying a
   * token that was already exchanged for a successor out from under them,
   * exactly what this must catch. Every OTHER still-active RefreshToken for
   * that User is revoked too, forcing a full re-login everywhere rather than
   * trusting the rest of that User's session family.
   *
   * A revoked-but-NOT-rotatedOut token (logout(), or the passcode-reset
   * mass-revoke) is deliberately NOT treated as a reuse signal — see
   * `rotatedOut`'s own model comment for the real bug this distinction fixes
   * (an ordinary logged-out token being refreshed again used to wrongly burn
   * every other device's session too). It's simply a 401, same as a token
   * that's unknown (bad hash, typo, fabricated) or expired — none of those
   * are evidence anything legitimate was replayed.
   *
   * FOUND ON REVIEW: a genuinely CONCURRENT replay (two requests presenting
   * the same still-valid token at nearly the same instant) used to slip past
   * both checks above — both reads see revokedAt: null before either writes,
   * so neither takes the sequential-replay branch — and only surfaced at the
   * optimistic-concurrency guard below, whose losing branch threw the same
   * "every session... signed out as a precaution" message WITHOUT actually
   * revoking anything else. That's exactly the case reuse-detection most
   * needs to fire for (an attacker racing the legitimate client), so the
   * loser now performs the real mass-revoke too, via the same shared
   * revokeAllRefreshTokensForUser() the sequential path already uses.
   */
  async refresh(dto: RefreshTokenDto): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    const existing = await this.prismaAuth.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      if (existing.rotatedOut) {
        await this.revokeAllRefreshTokensForUser(existing.userId);
        throw new UnauthorizedException('This refresh token was already used — every session for this account has been signed out as a precaution.');
      }
      throw new UnauthorizedException('This refresh token has been revoked — please log in again.');
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired — please log in again.');
    }

    // Optimistic-concurrency guard, same shape as every other status-transition
    // in this codebase — if a concurrent refresh() call already rotated this
    // exact token between the read above and this write, this call loses the
    // race and its write is a no-op; the loser still must not mint a second
    // valid token pair for the same presented token.
    //
    // The rotation and the successor token are written in ONE transaction: a
    // concurrent loser's update waits on this row's lock until it commits, so
    // its "burn the family" sweep below then also sees (and revokes) the
    // successor. Written separately, the sweep could run between the two
    // writes and miss it, leaving the winner a valid token after a replay.
    const refreshToken = await this.prismaAuth.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date(), rotatedOut: true },
      });
      return result.count === 0 ? null : this.issueRefreshToken(existing.userId, tx);
    });
    if (refreshToken === null) {
      // See this method's own header comment — a lost concurrency race is
      // the same replay signal as the sequential case above, not a softer one.
      await this.revokeAllRefreshTokensForUser(existing.userId);
      throw new UnauthorizedException('This refresh token was already used — every session for this account has been signed out as a precaution.');
    }

    const accessToken = await this.issueAccessToken(existing.userId);
    return { accessToken, refreshToken };
  }

  /**
   * Revokes exactly the one presented RefreshToken — the minimal companion
   * every refresh-token system needs to ship responsibly (without it, a
   * leaked token lives until its own 30-day expiry with no way to cut it
   * short). Deliberately NOT "log out everywhere": that's the reuse-detection
   * path in refresh() above, a reaction to a detected compromise, not an
   * ordinary user-initiated action — logging out one device shouldn't also
   * sign out every other device the same account is using elsewhere.
   * Silently succeeds for an already-revoked/unknown token — logging out is
   * idempotent by nature, not an error to report twice.
   */
  async logout(dto: RefreshTokenDto): Promise<{ message: string }> {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    await this.prismaAuth.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    return { message: 'Logged out' };
  }

  /**
   * Phase 43 (Decision 102 — PlatformAdminModule Support-tier impersonation is
   * read-only, resolved directly with the user). Mints a genuine tenant-realm
   * JwtPayload for `targetUserId` — same shape, same JWT_ACCESS_SECRET, same
   * JwtStrategy that verifies every ordinary tenant login token — so every
   * existing tenant endpoint (GET /bookings/me, GET /waivers/me, ...) "just
   * works" unmodified for a Support staffer impersonating that user. The one
   * addition, `impersonation`, is what JwtStrategy.validate() checks to reject
   * any non-read request on this token — see that file's own comment.
   *
   * `schoolId` scopes the grants claim to ONE tenant, per Spec 55 §12.1 Decision
   * 39 ("Platform Admin impersonation scope narrowed"): "the impersonation token
   * is minted scoped to the single RoleGrant matching the specific tenant
   * identified when impersonation was initiated, not the target user's full
   * grant set, so impersonating a multi-School Instructor or Franchise Owner to
   * help with one School never exposes the others." FOUND ON REVIEW (Phase 46):
   * this method originally pulled every one of the target's active RoleGrant
   * rows with no tenant filter at all — a real cross-tenant exposure Decision 39
   * exists specifically to close, not a hypothetical. Matches on `schoolId`
   * alone, never a Franchise-level grant (`schoolId` null) even when its
   * `franchiseId` covers the target School: `school_tenant_isolation`'s own RLS
   * policy (20260902000000_init) only ever admits a RoleGrant whose `schoolId`
   * equals the School's own id — a Franchise-level grant already can't reach
   * ordinary School-scoped data through that policy, and the one place it DOES
   * grant something (the Franchise School-roster read, `GET /franchises/{id}/
   * schools`) is exactly the "expose the others" breadth Decision 39 says an
   * impersonation session must not carry.
   *
   * RLS-LEVEL ENFORCEMENT (Phase 47): Phase 46 (the paragraph above) scoped only
   * the token's own CLAIMS — real progress, but proved (by grep: zero
   * server-side consumers of `payload.grants`; and empirically: `GET /v1/schools`
   * returning both Schools for a School-A-scoped token) that RLS itself never
   * consulted those claims, so the underlying data-access gap survived that phase
   * untouched. This phase closes it for real: `schoolId` is now also threaded
   * (via `RequestContext`, populated by `JwtStrategy.validate()` from this
   * token's own `impersonation.schoolId` claim) into
   * `PrismaAppService.withTenantContext`, which sets a second session variable,
   * `app.impersonation_school_id`, alongside `app.current_user_id`. Migration
   * `20261002000000_impersonation_scope_rls_fix` ANDs that variable into
   * `RoleGrant`'s own `rolegrant_self_only` policy and its
   * `is_active_school_owner_manager()` helper — see that migration's own header
   * comment for the full account of why narrowing just those two things is
   * sufficient to narrow every downstream tenant-scoped policy's own
   * EXISTS-against-RoleGrant subquery too, and for the one purpose-built endpoint
   * (`GET /franchises/{id}/schools`) that needed its own, separate fix instead.
   *
   * This RLS-level change was deliberately NOT attempted in the same pass as
   * Phase 46's claims-scoping fix — escalated to the product owner first, given
   * this exact class of change (RLS policy correctness) has already shipped
   * wrong twice before on a first attempt in this codebase (see
   * `ultm8-tenant-isolation` SKILL.md §2) — and built here only once explicitly
   * greenlit, verified against the full 278-test cross-tenant isolation gate
   * before merging, not assumed correct from code review alone.
   *
   * Deliberately mirrors issueAccessToken()'s own load-email-and-grants shape
   * rather than calling it directly — this one always takes a caller-supplied
   * short `ttlSeconds` (Platform Admin's own "time-boxed" requirement,
   * ultm8-tenant-isolation §3), never the ordinary 15-minute JWT_ACCESS_TTL
   * default issueAccessToken() relies on, and needs the extra `impersonation`
   * claim issueAccessToken() must never set.
   *
   * `targetUserId` not existing, or existing but holding no active RoleGrant at
   * `schoolId`, is a genuine 404, not the "shouldn't happen" internal-error case
   * issueAccessToken() assumes for its own always-already-authenticated caller —
   * a Platform Admin can supply any id/School combination here, including a
   * typo or a since-revoked grant, so both are checked and reported as a normal
   * client error rather than throwing a bare Error.
   */
  async issueImpersonationToken(
    targetUserId: string,
    schoolId: string,
    adminUserId: string,
    ttlSeconds: number,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const { user, grants } = await this.prismaApp.withTenantContext(targetUserId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: targetUserId }, select: { email: true } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const grants = await tx.roleGrant.findMany({
        where: { userId: targetUserId, schoolId, revokedAt: null },
        select: { role: true, franchiseId: true, schoolId: true, branchId: true },
      });
      if (grants.length === 0) {
        throw new NotFoundException('User has no active RoleGrant at this School');
      }
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
      impersonation: { adminUserId, startedAt: new Date().toISOString(), schoolId },
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
    // Standard security hygiene, same framing as the comment above — a passcode
    // reset is frequently how an account recovers from a suspected compromise,
    // so every refresh token issued under the OLD passcode is revoked here too.
    // Without this, a stolen refresh token would simply outlive the reset meant
    // to lock the attacker out, right up to its own 30-day expiry.
    await this.revokeAllRefreshTokensForUser(user.id);

    return { message: 'Passcode updated — you can now log in with your new passcode.' };
  }
}
