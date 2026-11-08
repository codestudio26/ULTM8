import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** POST /auth/legal-acceptance (Decision 448 item 8): the Terms and Privacy
 * "I agree" tick, at the first sign-in of someone who didn't sign up
 * themselves. Same field as sign-up's (RegisterDto.acceptTerms). */
export class AcceptLegalDto {
  @ApiProperty({ description: 'Must be true: agrees to the Terms of Service and has read the Privacy Policy (Decision 444, Decision 448 item 8).' })
  @IsBoolean()
  acceptTerms!: boolean;
}

export class AcceptLegalResponseDto {
  @ApiProperty({ description: 'A new access token without the legalPending claim. The refresh token is unchanged.' })
  accessToken!: string;
}
