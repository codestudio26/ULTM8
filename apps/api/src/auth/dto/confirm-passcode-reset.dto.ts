import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString, Length, Matches } from 'class-validator';

/**
 * Confirms the OTP sent by RequestPasscodeResetDto and sets a new passcode — the
 * "Create New Password" (still passcode-style) screen per Spec §8.1.
 *
 * NOTE: Decision 72's own follow-up explicitly calls the recovery flow's mechanics
 * "still undesigned" beyond the model-level confirmation that passcode is the sole
 * credential. This endpoint implements the minimum needed to make recovery possible
 * at all (reuse the already-confirmed Twilio Verify OTP mechanism) — it is a
 * reasonable-minimum stopgap, not a confirmed, final recovery-flow design. Flag before
 * treating this as settled (e.g. is a single OTP-gated reset enough, or does this need
 * additional identity verification given a compromised phone would otherwise be
 * enough to take over an account?).
 */
export class ConfirmPasscodeResetDto {
  @ApiProperty({ description: 'E.164 format' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone!: string;

  @ApiProperty({ description: 'The code delivered via Twilio Verify' })
  @IsString()
  @Length(4, 8)
  code!: string;

  @ApiProperty({ description: 'Exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'newPasscode must be exactly 6 digits' })
  newPasscode!: string;
}
