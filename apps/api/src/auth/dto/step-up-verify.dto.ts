import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** Re-enters the caller's own passcode to prove presence before a sensitive
 * action (Decision 236) — same 6-digit shape LoginDto already validates. */
export class StepUpVerifyDto {
  @ApiProperty({ description: "Exactly 6 digits — the caller's own current passcode" })
  @Matches(/^\d{6}$/, { message: 'passcode must be exactly 6 digits' })
  passcode!: string;
}
