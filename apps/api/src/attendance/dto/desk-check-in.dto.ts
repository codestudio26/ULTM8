import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

/** One guest seat to check in: the member's booking and the guest on it (Decision 377). */
export class DeskGuestRefDto {
  @ApiProperty()
  @IsUUID()
  bookingId!: string;

  @ApiProperty()
  @IsUUID()
  attendeeId!: string;
}

/**
 * POST /schools/{schoolId}/front-desk/check-ins (Decision 378, handover F7):
 * the welcome card's whole confirm in one call. Books each ticked Class the
 * Student isn't booked into, checks them in, and checks in the ticked guests,
 * all in one transaction: if one can't be done, none is.
 */
export class DeskCheckInDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiPropertyOptional({ description: 'From POST /schools/{schoolId}/front-desk/qr-lookups when the Student showed their app QR. Recorded as INSTRUCTOR_SCAN; without it, INSTRUCTOR_MANUAL.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lookupToken?: string;

  @ApiProperty({ type: [String], description: 'Classes to check the Student into (booked first where needed). Up to 10.' })
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  classIds!: string[];

  @ApiPropertyOptional({ type: [DeskGuestRefDto], description: "Guests on the Student's bookings to check in. Up to 20." })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DeskGuestRefDto)
  guests?: DeskGuestRefDto[];
}

export class DeskCheckInClassResultDto {
  @ApiProperty()
  classId!: string;

  @ApiProperty({ description: 'False when this Class is why nothing was done.' })
  ok!: boolean;

  @ApiPropertyOptional({ description: 'The checked-in booking, when done.' })
  bookingId?: string;

  @ApiPropertyOptional({ description: 'Why this Class could not be done, e.g. CHECK_IN_NOT_OPEN or CLASS_FULL.' })
  code?: string;

  @ApiPropertyOptional()
  message?: string;
}

export class DeskCheckInGuestResultDto {
  @ApiProperty()
  attendeeId!: string;

  @ApiProperty()
  ok!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  checkedInAt?: string;

  @ApiPropertyOptional()
  code?: string;

  @ApiPropertyOptional()
  message?: string;
}

export class DeskCheckInResponseDto {
  @ApiProperty({ description: 'True when everything was checked in. False when something could not be: then nothing was saved, and the item(s) with ok false say why.' })
  done!: boolean;

  @ApiProperty({ type: [DeskCheckInClassResultDto] })
  classes!: DeskCheckInClassResultDto[];

  @ApiProperty({ type: [DeskCheckInGuestResultDto] })
  guests!: DeskCheckInGuestResultDto[];
}
