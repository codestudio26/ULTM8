import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** POST /auth/passcode-change/first-login (Decision 1/230) — same single-field
 * shape as ConfirmPasscodeResetDto's own newPasscode (no confirm field there
 * either), the closer analog here: an existing account setting its passcode
 * for real, not a fresh registration choosing one for the first time. */
export class ChangePasscodeFirstLoginDto {
  @ApiProperty({ description: 'Exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'newPasscode must be exactly 6 digits' })
  newPasscode!: string;
}
