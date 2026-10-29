import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PostalAddressDto } from '../../common/address/postal-address.dto';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import { IsBirthDate } from '../../common/decorators/is-birth-date.decorator';
import { GenderField, type Gender } from '../../common/decorators/gender-field.decorator';

/** Names and username are trimmed before validation, so one made only of
 * spaces is refused as blank (sign-in review A7, as Decision 341 does for
 * profile edits). */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Confirmed base User fields (ultm8-domain-rules §3, Spec §6.1) collected at registration. */
export class RegisterDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'E.164 format' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "First name can't be blank." })
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "Surname can't be blank." })
  @MaxLength(100)
  surname!: string;

  @ApiProperty({ required: false, description: 'Mobile-only per confirmed field list' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(50)
  username?: string;

  @ApiProperty({ description: 'Exactly 6 digits — the account\'s sole login credential (Decision 72)' })
  @Matches(/^\d{6}$/, { message: 'passcode must be exactly 6 digits' })
  passcode!: string;

  @ApiProperty()
  @Matches(/^\d{6}$/, { message: 'passcodeConfirm must be exactly 6 digits' })
  passcodeConfirm!: string;

  @ApiProperty({ description: 'ISO 8601 date, no time component. Not in the future, not more than 120 years ago.' })
  @IsDateString()
  @IsBirthDate()
  dateOfBirth!: string;

  @GenderField()
  gender?: Gender | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  language?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** Decision 276 — the structured, country-aware address. When sent it takes
   * precedence over `address`, which the API then rebuilds from it; `null`
   * clears the address. See common/address/postal-address.dto.ts. */
  @ApiProperty({ required: false, type: () => PostalAddressDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PostalAddressDto)
  postalAddress?: PostalAddressDto | null;
}
