import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /users/me` — one partial-update endpoint covering every "edit this one
 * field" UI screen Spec 55 describes as `PATCH /users/me/{field}`, same convention
 * `PATCH /schools/:id` (CreateSchoolDto/UpdateSchoolDto) already established. See the
 * Phase 6 kickoff prompt for the full reasoning on why no separate per-field endpoint
 * is built.
 *
 * Deliberately excludes `email` and `phone` — both are unique login/OTP identifiers;
 * changing either warrants the same re-verification care Spec 55's account-deletion
 * flow (Decision 44) applies to a comparably sensitive action, not a bare PATCH field.
 * Deferred, not forgotten — see the Phase 6 kickoff prompt.
 *
 * Field list and length/format limits are lifted directly from RegisterDto
 * (auth/dto/register.dto.ts), which already established the confirmed length caps for
 * every one of these fields at registration time — kept identical here so a value
 * that was valid at registration is never subsequently rejected by a PATCH, and vice
 * versa. profilePhotoUrl follows CreateSchoolDto's logoUrl/bannerUrl convention (URL,
 * 2048-char cap) since RegisterDto has no equivalent of its own to copy from.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  surname?: string;

  @ApiPropertyOptional({ description: 'Mobile-only per confirmed field list' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date, no time component' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @ApiPropertyOptional({ description: 'One of the 4 confirmed languages — free text, no canonical code list confirmed anywhere yet (domain-rules §1).' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  language?: string;

  @ApiPropertyOptional({ description: 'One of the 6 confirmed currencies — same free-text caveat as language.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  profilePhotoUrl?: string;
}
