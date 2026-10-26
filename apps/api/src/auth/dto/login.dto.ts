import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';

/**
 * Login is email + passcode only (Spec §8.1: "Email + a 6-digit Passcode"; Decision 72:
 * the passcode is the sole credential, not a step-up factor alongside OTP).
 */
export class LoginDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @Matches(/^\d{6}$/, { message: 'passcode must be exactly 6 digits' })
  passcode!: string;
}
