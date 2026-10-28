import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** POST /auth/passcode-change (Decision 375, Q1) — a signed-in person changes
 * their own passcode by giving the current one. */
export class ChangePasscodeDto {
  @ApiProperty({ description: 'The current passcode, exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'currentPasscode must be exactly 6 digits' })
  currentPasscode!: string;

  @ApiProperty({ description: 'Exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'newPasscode must be exactly 6 digits' })
  newPasscode!: string;
}
