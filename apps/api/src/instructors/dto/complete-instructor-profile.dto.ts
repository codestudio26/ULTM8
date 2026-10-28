import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsPhoneNumber, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PostalAddressDto } from '../../common/address/postal-address.dto';

/**
 * `PATCH /instructors/me/profile` — Decision 1/217's self-service completion
 * of the four fields "Add Manually" leaves blank at creation. Applied across
 * every Instructor row the caller holds (flagged, not resolved: a
 * multi-School instructor can't set different values per School through
 * this one endpoint).
 *
 * Decision 331 adds `bio`, `photoUrl` and `phone`: here `phone` is the
 * School-facing `Instructor.phone` contact number, not the User's login/OTP
 * phone, which this endpoint still never touches (UpdateUserDto's own header
 * comment: changing a login identifier needs more care than a bare PATCH
 * field). `dateOfBirth` stays on `PATCH /users/me`.
 *
 * `certificationKey` is verified against R2 (InstructorsService.
 * completeMyProfile(), mirroring WaiversService.sign()'s own
 * upload-then-confirm discipline) before being accepted — never trusted as a
 * bare caller-supplied string.
 */
export class CompleteInstructorProfileDto {
  /** Decision 331 — the instructor edits their own bio, photo and the
   * School-facing contact phone (Instructor.phone, not their login phone).
   * Same limits as UpdateInstructorDto; null clears. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  photoUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'School-facing contact number, E.164 — not the login phone.' })
  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** Decision 276 — the structured, country-aware address. When sent it takes
   * precedence over `address`, which the API then rebuilds from it; `null`
   * clears the address. See common/address/postal-address.dto.ts. */
  @ApiPropertyOptional({ type: () => PostalAddressDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PostalAddressDto)
  postalAddress?: PostalAddressDto | null;

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
