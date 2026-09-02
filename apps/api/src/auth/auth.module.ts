import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TwilioVerifyService } from './otp/twilio-verify.service';
import { LoginAttemptTracker } from './login-attempt-tracker.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      // 15-minute access tokens for customer identities — confirmed, Spec §8.3.
      signOptions: { expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TwilioVerifyService, LoginAttemptTracker],
  exports: [AuthService],
})
export class AuthModule {}
