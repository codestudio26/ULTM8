import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /waivers/{id}/sign body. Confirmed e-signature mechanism (skills/
 * ultm8-domain-rules/SKILL.md §13, quoted): "a typed full name plus a signature
 * field." Two separate typed-text fields, not one — the confirmed WaiverSignature
 * row carries both "signer full name" and "signature" as distinct fields; a
 * signer conventionally types their name once for identification and again (or a
 * stylized variant) as the "signature" itself, mirroring common e-signature UX,
 * though Spec 55 doesn't further describe the UI distinction between the two.
 * Neither field accepts drawn/canvas signature data this phase — see
 * WaiverSignature's own schema comment for why.
 */
export class SignWaiverDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signerFullName!: string;

  @ApiProperty({ description: 'Typed signature text (not a drawn/canvas signature — see WaiverSignature\'s own schema comment).' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signatureText!: string;
}
