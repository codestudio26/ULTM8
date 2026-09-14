import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * POST /waivers/{id}/sign body. Confirmed e-signature mechanism (skills/
 * ultm8-domain-rules/SKILL.md §13, quoted): "a typed full name plus a signature
 * field." Two separate typed-text fields, not one — the confirmed WaiverSignature
 * row carries both "signer full name" and "signature" as distinct fields; a
 * signer conventionally types their name once for identification and again (or a
 * stylized variant) as the "signature" itself, mirroring common e-signature UX,
 * though Spec 55 doesn't further describe the UI distinction between the two.
 *
 * `signatureImageKey` (Phase 34) is the OPTIONAL drawn-signature-capture upgrade
 * (Decision 74/78) — the R2 object key returned by a prior
 * POST /waivers/{id}/signature-upload-url call, once that upload has actually
 * completed. Optional, not required: signing via typed name alone remains valid
 * (see WaiverSignature's own schema comment). WaiversService.sign() validates
 * this key exactly matches the expected `waiver-signatures/{schoolId}/{waiverId}/
 * {studentId}/...` prefix for THIS specific waiver/caller before accepting it —
 * a caller cannot reference an object uploaded for a different waiver, a
 * different Student, or an arbitrary external key.
 */
export class SignWaiverDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signerFullName!: string;

  @ApiProperty({ description: 'Typed signature text (the confirmed baseline mechanism — see WaiverSignature\'s own schema comment).' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signatureText!: string;

  @ApiPropertyOptional({ description: 'R2 object key from a prior POST /waivers/{id}/signature-upload-url call — see this DTO\'s own header comment.' })
  @IsOptional()
  @IsString()
  @MinLength(1) // FOUND ON REVIEW: '' passed @IsOptional/@IsString unchallenged, then got persisted as
  // an empty string rather than the nullable column's intended "no image" state — sign()'s own
  // `if (dto.signatureImageKey)` check treated '' as falsy for the *validation* it skipped, but
  // still wrote '' to the DB. Rejecting it here instead of silently normalizing it is more honest
  // about a malformed request than quietly coercing it.
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9/_.-]+$/, { message: 'signatureImageKey may only contain letters, digits, and / _ . -' })
  signatureImageKey?: string;
}
