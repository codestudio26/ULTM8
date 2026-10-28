import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { StepUpService } from './step-up.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasscodeResetDto } from './dto/request-passcode-reset.dto';
import { ConfirmPasscodeResetDto } from './dto/confirm-passcode-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasscodeFirstLoginDto } from './dto/change-passcode-first-login.dto';
import { ChangePasscodeDto } from './dto/change-passcode.dto';
import { StepUpVerifyDto } from './dto/step-up-verify.dto';
import { AuthMessageResponseDto, LoginResponseDto } from './dto/auth-response.dto';
import { StepUpResponseDto } from './dto/step-up-response.dto';
import { bodyIdentityTracker, jwtSubTracker } from '../common/throttle/identity-trackers';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from './interfaces/jwt-payload.interface';

// Rate limiting on /auth/otp/* and /auth/login — confirmed, Spec §11.5. Decision 12
// requires this decoupled from raw IP: a shared IP (office wifi, a school's front-desk
// device) must not let one caller's bad attempts lock out every other caller on it.
// Two independent, AND-ed dimensions (see identity-trackers.ts's own header comment
// for why they're two separate named throttlers, not one combined key): `identity`
// stays at the same 5/60s strictness a single caller always had; `default` (IP) is
// loosened to a generous volumetric backstop that only fires on genuine
// credential-stuffing floods across many identities, not shared-IP false positives.
// LoginAttemptTracker (per-account escalating lockout) is the separate, still
// Architect-review-pending mechanism this does NOT touch — see its own header comment.
const EMAIL_AUTH_THROTTLE = {
  default: { limit: 20, ttl: 60_000 },
  identity: { limit: 5, ttl: 60_000, getTracker: bodyIdentityTracker('email') },
};
const PHONE_AUTH_THROTTLE = {
  default: { limit: 20, ttl: 60_000 },
  identity: { limit: 5, ttl: 60_000, getTracker: bodyIdentityTracker('phone') },
};
// Decision 236 — same identity-only strictness as login's own passcode guess
// (EMAIL_AUTH_THROTTLE above); keyed by the caller's already-authenticated
// `sub`, not email/phone, since this route sits behind JwtAuthGuard.
const STEP_UP_VERIFY_THROTTLE = {
  identity: { limit: 5, ttl: 60_000, getTracker: jwtSubTracker },
};
// Decision 1/230 — same reasoning as STEP_UP_VERIFY_THROTTLE above: this also
// sits behind JwtAuthGuard, so it's keyed by the caller's own `sub`, not a
// request-body field (bodyIdentityTracker('phone') would just fall back to
// IP here — this body has no phone field at all).
const PASSCODE_CHANGE_THROTTLE = {
  identity: { limit: 5, ttl: 60_000, getTracker: jwtSubTracker },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly stepUpService: StepUpService,
  ) {}

  @ApiCreatedResponse({ type: AuthMessageResponseDto })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiCreatedResponse({ type: AuthMessageResponseDto })
  @Throttle(PHONE_AUTH_THROTTLE)
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @ApiCreatedResponse({ type: AuthMessageResponseDto })
  @Throttle(PHONE_AUTH_THROTTLE)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @ApiCreatedResponse({ type: LoginResponseDto })
  @Throttle(EMAIL_AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // No Throttle here, unlike every endpoint above — those all guess/verify a
  // low-entropy, human-chosen value (a 6-digit passcode/OTP), which is exactly
  // what rate limiting defends against. A refresh token is a 256-bit random
  // value (AuthService's own issueRefreshToken() comment) — brute-forcing it
  // is infeasible regardless of request rate, so there's nothing a throttle
  // here would actually be defending.
  @ApiCreatedResponse({ type: LoginResponseDto })
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @ApiCreatedResponse({ type: AuthMessageResponseDto })
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @ApiCreatedResponse({ type: AuthMessageResponseDto })
  @Throttle(PHONE_AUTH_THROTTLE)
  @Post('forgot-password')
  requestPasscodeReset(@Body() dto: RequestPasscodeResetDto) {
    return this.authService.requestPasscodeReset(dto);
  }

  @ApiCreatedResponse({ type: AuthMessageResponseDto })
  @Throttle(PHONE_AUTH_THROTTLE)
  @Post('reset-password')
  confirmPasscodeReset(@Body() dto: ConfirmPasscodeResetDto) {
    return this.authService.confirmPasscodeReset(dto);
  }

  // Decision 236 — step-up re-authentication for an already-logged-in user
  // confirming a sensitive action (today: Guardian BASELINE consent
  // withdrawal). Behind JwtAuthGuard, unlike every other route in this
  // controller — the caller must already hold a valid session; this only
  // re-proves presence for one specific next action.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: StepUpResponseDto })
  @Throttle(STEP_UP_VERIFY_THROTTLE)
  @Post('step-up/verify')
  verifyStepUp(@CurrentUser() user: JwtPayload, @Body() dto: StepUpVerifyDto) {
    return this.stepUpService.verify(user.sub, dto);
  }

  // Decision 1/230 — the one route a passcodeChangePurpose token (minted by
  // login() when mustChangePasscode is set) may call — see
  // JwtStrategy.validate()'s PASSCODE_CHANGE_ALLOWED_PATH.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: LoginResponseDto })
  @Throttle(PASSCODE_CHANGE_THROTTLE)
  @Post('passcode-change/first-login')
  changePasscodeFirstLogin(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasscodeFirstLoginDto) {
    return this.authService.changePasscodeFirstLogin(user.sub, dto);
  }

  // Decision 375 (Q1) — "Change passcode" on My profile, for a signed-in
  // person. Same per-caller throttle as the first-login change.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: LoginResponseDto })
  @Throttle(PASSCODE_CHANGE_THROTTLE)
  @Post('passcode-change')
  changePasscode(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasscodeDto) {
    return this.authService.changePasscode(user.sub, dto);
  }
}
