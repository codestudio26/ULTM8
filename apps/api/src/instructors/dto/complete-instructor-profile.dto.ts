import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `PATCH /instructors/me/profile` — Decision 1/217's self-service completion
 * of the four fields "Add Manually" leaves blank at creation. Applied across
 * every Instructor row the caller holds (flagged, not resolved: a
 * multi-School instructor can't set different values per School through
 * this one endpoint).
 *
 * Deliberately does NOT cover `phone`/`dateOfBirth` (User-level, not
 * Instructor-level) — `dateOfBirth` is already settable via the existing
 * `PATCH /users/me`; `phone` is deliberately excluded from that endpoint
 * entirely (UpdateUserDto's own header comment: a login/OTP identifier,
 * changing it needs more care than a bare PATCH field), and this endpoint
 * doesn't carve out a special case for an Instructor created this way.
 *
 * `certificationKey` is verified against R2 (InstructorsService.
 * completeMyProfile(), mirroring WaiversService.sign()'s own
 * upload-then-confirm discipline) before being accepted — never trusted as a
 * bare caller-supplied string.
 */
export class CompleteInstructorProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  activities?: string[];

  @ApiPropertyOptional({ description: 'The key returned by POST /instructors/me/certification-upload-url, after uploading to it.' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  certificationKey?: string;

  @ApiPropertyOptional({ description: 'Set true to record consent to holding a certification record. Can only move from unset to set — not a way to withdraw it.' })
  @IsOptional()
  @IsBoolean()
  certificationConsent?: boolean;
}
