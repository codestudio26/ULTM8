import { ApiProperty } from '@nestjs/swagger';

/** Response for POST /instructors/:id/resend-passcode (Decision 331). */
export class ResendPasscodeResponseDto {
  @ApiProperty({ description: 'False when the new passcode was set but the email could not be sent.' })
  emailSent!: boolean;
}
