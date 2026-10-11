import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StepUpService } from './step-up.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TwilioVerifyService } from './otp/twilio-verify.service';
import { LoginAttemptTracker } from './login-attempt-tracker.service';
import { QueueModule } from '../jobs/queue.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      // 15-minute access tokens for customer identities — confirmed, Spec §8.3.
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
    }),
    // Phase 5 — TwilioVerifyService.sendOtp() now enqueues onto the otp-delivery
    // queue instead of calling Twilio synchronously; needs QueueModule for the
    // @InjectQueue it uses.
    QueueModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, StepUpService, JwtStrategy, TwilioVerifyService, LoginAttemptTracker],
  // TwilioVerifyService exported so JobsModule's OtpDeliveryProcessor can call its
  // sendOtpNow() — the actual Twilio call now lives behind the queue, not in front of
  // it. StepUpService exported so GuardiansModule can gate BASELINE consent
  // withdrawal on it (Decision 236) without duplicating the step-up mechanism —
  // one-directional (AuthModule doesn't import GuardiansModule), not a cycle.
  exports: [AuthService, StepUpService, TwilioVerifyService],
})
export class AuthModule {}
