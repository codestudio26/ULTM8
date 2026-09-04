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
} from 'class-validator';

/** Confirmed base User fields (ultm8-domain-rules §3, Spec §6.1) collected at registration. */
export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'E.164 format' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  surname!: string;

  @ApiProperty({ required: false, description: 'Mobile-only per confirmed field list' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  username?: string;

  @ApiProperty({ description: 'Exactly 6 digits — the account\'s sole login credential (Decision 72)' })
  @Matches(/^\d{6}$/, { message: 'passcode must be exactly 6 digits' })
  passcode!: string;

  @ApiProperty()
  @Matches(/^\d{6}$/, { message: 'passcodeConfirm must be exactly 6 digits' })
  passcodeConfirm!: string;

  @ApiProperty({ description: 'ISO 8601 date, no time component' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  gender?: string;

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
}
