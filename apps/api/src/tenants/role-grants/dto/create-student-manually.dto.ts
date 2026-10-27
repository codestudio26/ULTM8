import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';
import { IsBirthDate } from '../../../common/decorators/is-birth-date.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Students "Add manually" (Decision 366) — the owner enrols an adult who has
 * no ULTM8 account yet, the same way Staff and Instructors are added by hand
 * (Decisions 230, 251): a real account at once, a temporary passcode emailed,
 * a new passcode chosen at first sign-in. Adults only: a child joins through a
 * Guardian (domain rules §14), so the date of birth is required.
 */
export class CreateStudentManuallyDto {
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

  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'YYYY-MM-DD. The student must be 18 or over.' })
  @IsDateString()
  @IsBirthDate()
  dateOfBirth!: string;

  @ApiPropertyOptional({ description: 'Required when the School has open branches: the home branch.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
