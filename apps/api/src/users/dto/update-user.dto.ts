import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PostalAddressDto } from '../../common/address/postal-address.dto';
import { IsBirthDate } from '../../common/decorators/is-birth-date.decorator';

/** Names and username are trimmed before validation, so one made only of
 * spaces is refused as blank (Decision 324, S7). */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

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
 *
 * `username`/`gender`/`nationality`/`language`/`currency`/`address`/`weightCategory`/
 * `kimonoSize`/`beltSize` are typed `| null` (closing a real contract gap, not a new
 * feature): each is nullable on `User` itself, and `UsersService.updateProfileFor`
 * already passes each straight through to Prisma unconditionally — `undefined`
 * (omitted) leaves the existing value alone, an explicit `null` clears it, confirmed
 * already working at runtime for weightCategory/kimonoSize/beltSize (`users.
 * e2e-spec.ts`'s own round-trip test) since `@IsOptional()` skips every validator
 * below it for BOTH `null` and `undefined` (verified directly against the installed
 * class-validator's own `IsOptional` source, not assumed). The ONLY thing missing was
 * this type signature itself admitting `null` — without it, no generated client could
 * construct a type-safe call to clear any of these fields once set, so no caller ever
 * tried. `firstName`/`surname` stay required (`User` itself has them NOT NULL) and
 * `dateOfBirth`/`profilePhotoUrl` stay `string | undefined` on purpose: dateOfBirth is
 * deliberately one-way (see its own schema comment — `UsersService.
 * updateProfileFor`'s explicit `=== null` guard rejects clearing it), and
 * profilePhotoUrl's only present writer (`useUploadMyProfilePhoto`) always supplies a
 * real URL — no UI anywhere offers "remove my photo," so widening it here would admit
 * a path nothing exercises yet; revisit together if that UI is ever built.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "First name can't be blank." })
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "Surname can't be blank." })
  @MaxLength(100)
  surname?: string;

  @ApiPropertyOptional({ description: 'Mobile-only per confirmed field list. Null clears it.', type: String, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "Username can't be blank. Leave it empty to remove it." })
  @MaxLength(50)
  username?: string | null;

  /** Decision 324 (S5): a real calendar date, not in the future and not more
   * than 120 years ago. */
  @ApiPropertyOptional({ description: 'ISO 8601 date, no time component. Not in the future, not more than 120 years ago.' })
  @IsOptional()
  @IsDateString()
  @IsBirthDate()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: 'Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  gender?: string | null;

  @ApiPropertyOptional({ description: 'Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string | null;

  @ApiPropertyOptional({
    description: 'One of the 4 confirmed languages — free text, no canonical code list confirmed anywhere yet (domain-rules §1). Null clears it.',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  language?: string | null;

  @ApiPropertyOptional({
    description: 'An ISO 4217 code from the Stripe-supported currency list (GET /settings/currencies, ~135 currencies) — same free-text caveat as language. Null clears it.',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currency?: string | null;

  @ApiPropertyOptional({ description: 'Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  /** Decision 276 — the structured, country-aware address. When sent it takes
   * precedence over `address`, which the API then rebuilds from it; `null`
   * clears the address. See common/address/postal-address.dto.ts. */
  @ApiPropertyOptional({ type: () => PostalAddressDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PostalAddressDto)
  postalAddress?: PostalAddressDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  profilePhotoUrl?: string;

  /**
   * Decision 220/246 — Student Detail Measurements, approved for build as real
   * fields on `User`. Free text, same `@MaxLength(50)` caveat as `gender`/
   * `nationality` above: nothing confirms an enum, unit, or canonical code list for
   * any of these three, so this is a developer-level presentation choice (plain
   * text), not an invented business rule.
   */
  @ApiPropertyOptional({ description: 'Free text — no confirmed enum/unit (Decision 220/246). Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  weightCategory?: string | null;

  @ApiPropertyOptional({ description: 'Free text — no confirmed enum/unit (Decision 220/246). Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  kimonoSize?: string | null;

  @ApiPropertyOptional({ description: 'Free text — no confirmed enum/unit (Decision 220/246). Null clears it.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  beltSize?: string | null;
}
