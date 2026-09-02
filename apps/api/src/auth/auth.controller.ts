import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasscodeResetDto } from './dto/request-passcode-reset.dto';
import { ConfirmPasscodeResetDto } from './dto/confirm-passcode-reset.dto';

// Rate limiting on /auth/otp/* and /auth/login — confirmed, Spec §11.5.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  requestPasscodeReset(@Body() dto: RequestPasscodeResetDto) {
    return this.authService.requestPasscodeReset(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  confirmPasscodeReset(@Body() dto: ConfirmPasscodeResetDto) {
    return this.authService.confirmPasscodeReset(dto);
  }
}
