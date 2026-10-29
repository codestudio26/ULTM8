import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import { IsBirthDate } from '../../common/decorators/is-birth-date.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** An optional text field: blank means not given. */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/**
 * Decision 392 (handover F5): what someone types on the front-desk tablet's
 * sign-up form. Name, date of birth and email are needed (the account and its
 * emails); the rest may be left blank.
 */
export class KioskSignUpDto {
  @ApiProperty({ enum: ['VISITOR', 'MEMBER'] })
  @IsIn(['VISITOR', 'MEMBER'])
  kind!: 'VISITOR' | 'MEMBER';

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

  @ApiProperty({ description: 'YYYY-MM-DD. 18 or over: a child is signed up by their Guardian in the app.' })
  @IsDateString()
  @IsBirthDate()
  dateOfBirth!: string;

  @ApiPropertyOptional({ enum: ['FEMALE', 'MALE'], nullable: true, description: 'Decision 315 item 15: Female, Male or not given.' })
  @Transform(blankToNull)
  @IsOptional()
  @IsIn(['FEMALE', 'MALE'])
  gender?: 'FEMALE' | 'MALE' | null;

  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "One of the School's \"How did you hear about us?\" choices, as shown." })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  heardFrom?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  emergencyPhone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  emergencyRelationship?: string | null;
}

export class KioskSignUpCreatedDto {
  @ApiProperty() id!: string;
}

export class SignUpListQueryDto {
  @ApiPropertyOptional({ enum: ['WAITING', 'REJECTED', 'DONE'], description: 'WAITING (default): waiting for staff or for the person to accept. REJECTED: the last 30 days. DONE: approved or declined.' })
  @IsOptional()
  @IsIn(['WAITING', 'REJECTED', 'DONE'])
  view?: 'WAITING' | 'REJECTED' | 'DONE';
}

export class ApproveSignUpDto {
  @ApiPropertyOptional({ description: "The home branch, when the sign-up came from a School-wide tablet at a School with branches." })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class AcceptSignUpInviteDto {
  @ApiPropertyOptional({ description: 'Your home branch, when the School has branches and the invite names none.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class SignUpDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['VISITOR', 'MEMBER'] }) kind!: string;
  @ApiProperty({ enum: ['PENDING', 'INVITED', 'APPROVED', 'REJECTED', 'DECLINED'] }) status!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() surname!: string;
  @ApiProperty({ format: 'date-time' }) dateOfBirth!: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) gender!: string | null;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) heardFrom!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) emergencyName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) emergencyPhone!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) emergencyRelationship!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) branchId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) branchName!: string | null;
  @ApiProperty({ description: 'The email already has a ULTM8 account: approving sends it an invite to accept in the app.' })
  hasAccount!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'The account it became, or the one invited.' })
  userId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) approvedByName!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) approvedAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectedByName!: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) rejectedAt!: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'A rejected sign-up is deleted on this day (Decision 362).' })
  deletesAt!: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) respondedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class SignUpListDto {
  @ApiProperty({ type: [SignUpDto] }) items!: SignUpDto[];
}

export class ApproveSignUpResultDto {
  @ApiProperty({ type: SignUpDto }) signUp!: SignUpDto;
  @ApiProperty({ description: 'A new account was made and its temporary passcode emailed.' }) accountCreated!: boolean;
  @ApiProperty({ description: 'The email had an account: it was sent an invite to accept.' }) invited!: boolean;
  @ApiProperty({ description: 'A Visitor got a visit pass. False when the School has no visitor period set.' }) visitPassGiven!: boolean;
  @ApiProperty({ description: 'The email could not be sent.' }) emailFailed!: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Only when the passcode email failed: hand it over in person.' })
  temporaryPasscode!: string | null;
}

export class SignUpInviteDto {
  @ApiProperty() id!: string;
  @ApiProperty() schoolId!: string;
  @ApiProperty() schoolName!: string;
  @ApiProperty({ enum: ['VISITOR', 'MEMBER'] }) kind!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) branchId!: string | null;
  @ApiProperty({ description: 'The School has open branches and the invite names none: choose one when accepting.' }) needsBranch!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class SignUpInviteListDto {
  @ApiProperty({ type: [SignUpInviteDto] }) items!: SignUpInviteDto[];
}

export class AcceptSignUpInviteResultDto {
  @ApiProperty() schoolId!: string;
  @ApiProperty() visitPassGiven!: boolean;
  @ApiPropertyOptional({ description: 'A fresh access token carrying the new STUDENT grant.' }) accessToken?: string;
}
