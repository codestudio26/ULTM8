import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { StepUpVerifyDto } from './dto/step-up-verify.dto';

// Decision 9 — Developer-level choice, same tier as every other named *_TTL
// constant in this codebase. Short enough that a captured/leaked step-up token
// is useless quickly, long enough to complete the one request it gates without
// the user re-entering their passcode a second time.
const STEP_UP_TOKEN_TTL_SECONDS = Number(process.env.STEP_UP_TOKEN_TTL_SECONDS ?? 300);
const STEP_UP_SCOPE = 'GUARDIAN_SENSITIVE_ACTION';

interface StepUpPayload {
  sub: string;
  scope: typeof STEP_UP_SCOPE;
}

/**
 * Decision 9 — a short-lived re-authentication proof for an already-logged-in
 * user confirming a sensitive action. Today's one consumer is Guardian BASELINE
 * consent withdrawal (GuardiansService.withdrawConsent()); Decision 9's own
 * approved text also names "any charge against a saved payment method" as a
 * second, not-yet-built consumer — this service is deliberately generic
 * (lives in AuthModule, not GuardiansModule) so that can reuse it later
 * without a second implementation.
 *
 * Deliberately NOT a second access token: this never goes through
 * JwtStrategy/JwtAuthGuard (it would otherwise need a route-allowlist entry
 * there, same as Kid Mode's KID_MODE_ALLOWED_PATH) — it is signed and verified
 * directly here, with its own narrow payload shape, and is only ever passed as
 * a one-off header (`X-Step-Up-Token`) on the single request it gates. Reuses
 * JWT_ACCESS_SECRET (same JwtModule.register() config AuthModule already has)
 * rather than a second secret — no new secret store needed for a 5-minute
 * proof.
 *
 * Passcode re-entry only this phase — OTP-as-alternative (mentioned in Decision
 * 9's own text, "no new MFA system required") is a real fast-follow, not built
 * here.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly prismaAuth: PrismaAuthService,
    private readonly jwt: JwtService,
  ) {}

  /** Re-checks the caller's own passcode and, on success, mints a short-lived
   * step-up proof scoped to exactly this caller. */
  async verify(callerId: string, dto: StepUpVerifyDto): Promise<{ stepUpToken: string; expiresAt: string }> {
    const user = await this.prismaAuth.user.findUnique({
      where: { id: callerId },
      select: { passcodeHash: true },
    });
    const matches = user ? await bcrypt.compare(dto.passcode, user.passcodeHash) : false;
    if (!matches) {
      throw new ForbiddenException({ code: 'INVALID_PASSCODE', message: 'Incorrect passcode.' });
    }

    const payload: StepUpPayload = { sub: callerId, scope: STEP_UP_SCOPE };
    const stepUpToken = this.jwt.sign(payload, { expiresIn: STEP_UP_TOKEN_TTL_SECONDS });
    const expiresAt = new Date(Date.now() + STEP_UP_TOKEN_TTL_SECONDS * 1000).toISOString();
    return { stepUpToken, expiresAt };
  }

  /**
   * Verifies a presented step-up token proves THIS caller, for the sensitive-
   * action scope, and hasn't expired. Throws a `{code: 'STEP_UP_REQUIRED'}` 403
   * — matching HttpExceptionFilter.extractCode()'s `{code,message}` envelope —
   * on any failure (missing, malformed, wrong caller, wrong scope, expired),
   * never leaking which of those it was.
   *
   * Reusable within its TTL window, not strictly single-use — true single-use
   * would need new tracking state (a schema addition this phase deliberately
   * avoids); flagged, not resolved, same as every other known-open item in
   * this PR's description.
   */
  assertVerified(callerId: string, stepUpToken: string | undefined): void {
    const fail = () => {
      throw new ForbiddenException({
        code: 'STEP_UP_REQUIRED',
        message: 'Re-enter your passcode to confirm this action.',
      });
    };
    if (!stepUpToken) fail();

    let payload: StepUpPayload;
    try {
      payload = this.jwt.verify<StepUpPayload>(stepUpToken as string);
    } catch {
      return fail();
    }
    if (payload.scope !== STEP_UP_SCOPE || payload.sub !== callerId) {
      fail();
    }
  }
}
