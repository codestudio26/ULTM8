import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';
import { IsBirthDate } from '../../../common/decorators/is-birth-date.decorator';
import { CONTACT_FIELDS, UpdateUserDto } from '../../../users/dto/update-user.dto';
import { JOIN_DATE_FORMAT } from '../../schools/student-join-dates';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Students "Add manually" (Decision 371) — the owner enrols an adult who has
 * no ULTM8 account yet, the same way Staff and Instructors are added by hand
 * (Decisions 230, 251): a real account at once, a temporary passcode emailed,
 * a new passcode chosen at first sign-in. Adults only: a child joins through a
 * Guardian (domain rules §14), so the date of birth is required.
 */
export class CreateStudentManuallyDto extends PickType(UpdateUserDto, CONTACT_FIELDS) {
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

  /** Decision 315 item 4: defaults to today; an earlier day may be given, never a future one. */
  @ApiPropertyOptional({ description: 'YYYY-MM-DD. The day they joined; today when omitted. Not in the future.' })
  @IsOptional()
  @Matches(JOIN_DATE_FORMAT, { message: 'Enter the join date as YYYY-MM-DD.' })
  joinedOn?: string;
}
