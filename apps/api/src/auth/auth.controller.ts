import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasscodeResetDto } from './dto/request-passcode-reset.dto';
import { ConfirmPasscodeResetDto } from './dto/confirm-passcode-reset.dto';
import { AuthMessageResponseDto, LoginResponseDto } from './dto/auth-response.dto';
import { bodyIdentityTracker } from '../common/throttle/identity-trackers';

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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
