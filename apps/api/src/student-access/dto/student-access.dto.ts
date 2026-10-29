import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import { IsBirthDate } from '../../common/decorators/is-birth-date.decorator';
import { GenderField } from '../../common/decorators/gender-field.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ChildDetailsDto {
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

  @ApiProperty({ description: 'YYYY-MM-DD. The child must be under 18.' })
  @IsDateString()
  @IsBirthDate()
  dateOfBirth!: string;

  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE'], nullable: true })
  @GenderField()
  gender?: 'FEMALE' | 'MALE' | null;
}

export class GuardianDetailsDto {
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
}

/** Decision 403: the owner adds a child and names their Guardian. */
export class AddChildManuallyDto {
  @ApiProperty({ type: ChildDetailsDto })
  @ValidateNested()
  @Type(() => ChildDetailsDto)
  child!: ChildDetailsDto;

  @ApiProperty({ type: GuardianDetailsDto, description: 'An email that already has an account gets an invite to accept in the app; a new one gets an account with a temporary passcode.' })
  @ValidateNested()
  @Type(() => GuardianDetailsDto)
  guardian!: GuardianDetailsDto;

  @ApiPropertyOptional({ description: 'Required when the School has open branches: the child\'s home branch.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class AddChildManuallyResponseDto {
  @ApiProperty({ enum: ['GUARDIAN_CREATED', 'GUARDIAN_INVITED'], description: 'GUARDIAN_CREATED: a new Guardian account was made and the child enrolled. GUARDIAN_INVITED: the Guardian already has an account and must accept in the app.' })
  outcome!: 'GUARDIAN_CREATED' | 'GUARDIAN_INVITED';

  @ApiProperty()
  guardianEmail!: string;

  @ApiProperty({ description: 'False when the email to the Guardian could not be sent.' })
  emailSent!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'GUARDIAN_CREATED: the enrolled child.' })
  studentId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'GUARDIAN_INVITED: the invite.' })
  inviteId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'GUARDIAN_CREATED: the Guardian\'s temporary passcode, shown once. Stored only as a hash.' })
  temporaryPasscode!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  temporaryPasscodeExpiresAt!: string | null;
}

export class TemporaryPasscodeStatusDto {
  @ApiProperty({ description: 'A new temporary passcode can be made: the account (the student\'s, or for a child their Guardian\'s) was made by this School and has not been signed in to yet.' })
  available!: boolean;

  @ApiProperty({ description: 'The passcode is on the child\'s Guardian\'s account.' })
  forGuardian!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Whose account it is, for "for {name}".' })
  accountName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiresAt!: string | null;

  @ApiProperty({ description: 'The current temporary passcode has expired.' })
  expired!: boolean;
}

export class NewTemporaryPasscodeResponseDto {
  @ApiProperty({ description: 'Shown once. Stored only as a hash.' })
  temporaryPasscode!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  forGuardian!: boolean;

  @ApiProperty()
  accountName!: string;

  @ApiProperty()
  email!: string;
}

export class ChildInviteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiProperty()
  childFirstName!: string;

  @ApiProperty()
  childSurname!: string;

  @ApiProperty()
  childDateOfBirth!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'For the School\'s list: the Guardian\'s name.' })
  guardianName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'For the School\'s list: the Guardian\'s email.' })
  guardianEmail!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class ChildInviteListDto {
  @ApiProperty({ type: [ChildInviteDto] })
  items!: ChildInviteDto[];
}

export class AcceptChildInviteResponseDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;
}
