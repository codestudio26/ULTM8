import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Guest waiver links (Waivers Q9): each guest on a booking signs the School's
 * waivers on a web page, with no account. */

export class GuestWaiverPageWaiverDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ description: 'Send it back when signing; a waiver changed since is refused.' })
  version!: number;

  @ApiProperty()
  signed!: boolean;
}

export class GuestWaiverPageDto {
  @ApiProperty()
  schoolName!: string;

  @ApiProperty()
  classTitle!: string;

  @ApiProperty({ format: 'date-time' })
  classStartsAt!: string;

  @ApiProperty({ format: 'date-time' })
  classEndsAt!: string;

  @ApiProperty({ enum: ['OPEN', 'CLOSED'], description: 'CLOSED: the booking was cancelled, the class has ended or the School has closed.' })
  status!: 'OPEN' | 'CLOSED';

  @ApiProperty({ type: [GuestWaiverPageWaiverDto], description: "The School's current waivers." })
  waivers!: GuestWaiverPageWaiverDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The guest named on an earlier signature on this link, if any.' })
  guestFullName!: string | null;
}

export class GuestWaiverSignItemDto {
  @ApiProperty()
  @IsUUID()
  waiverId!: string;

  @ApiProperty({ description: 'The version the guest read (GuestWaiverPageWaiverDto.version).' })
  @IsInt()
  @Min(1)
  version!: number;
}

export class SignGuestWaiversDto {
  @ApiProperty({ description: "The guest's full name." })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  guestFullName!: string;

  @ApiProperty({ description: "The guest's date of birth, YYYY-MM-DD." })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'guestDateOfBirth must be a date in the form YYYY-MM-DD.' })
  guestDateOfBirth!: string;

  @ApiProperty({ description: "Who is signing: the guest, or for a guest under 18 their parent or guardian." })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signerFullName!: string;

  @ApiProperty({ description: 'Typed signature.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signatureText!: string;

  @ApiProperty({ type: [GuestWaiverSignItemDto], description: 'Every current waiver the guest has not signed yet.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GuestWaiverSignItemDto)
  waivers!: GuestWaiverSignItemDto[];
}

export class SignGuestWaiversResponseDto {
  @ApiProperty()
  signed!: number;
}

export class BookingGuestDto {
  @ApiProperty()
  attendeeId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The guest's signing link. Only for the booker and the School Owner/Manager, and null when the portal address isn't set up." })
  link!: string | null;

  @ApiProperty({ enum: ['SIGNED', 'UNSIGNED', 'NONE'], description: "NONE: the School has no current waiver to sign." })
  waiverStatus!: 'SIGNED' | 'UNSIGNED' | 'NONE';

  @ApiPropertyOptional({ type: String, nullable: true })
  guestFullName!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'When the guest was checked in at the desk (Decision 377); null if not yet.' })
  checkedInAt!: string | null;
}

export class BookingGuestsDto {
  @ApiProperty()
  bookingId!: string;

  @ApiProperty({ description: "The class asks for a signed waiver, so its guests should sign one too." })
  waiverRequired!: boolean;

  @ApiProperty({ type: [BookingGuestDto] })
  guests!: BookingGuestDto[];
}

export class ClassGuestWaiversDto {
  @ApiProperty()
  waiverRequired!: boolean;

  @ApiProperty({ type: [BookingGuestsDto], description: 'Upcoming bookings with guests.' })
  bookings!: BookingGuestsDto[];
}

export class FriendPassDto {
  @ApiProperty()
  membershipId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Only good for this class.' })
  scopedClassId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  expiryDate!: string | null;
}

export class FriendPassListDto {
  @ApiProperty({ type: [FriendPassDto] })
  items!: FriendPassDto[];
}

export class GuestWaiverSignatureDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  guestFullName!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  guestDateOfBirth!: string;

  @ApiProperty()
  signerFullName!: string;

  @ApiProperty()
  signatureText!: string;

  @ApiProperty()
  signedByGuardian!: boolean;

  @ApiProperty()
  classTitle!: string;

  @ApiProperty({ format: 'date-time' })
  classStartsAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  bookedByName!: string | null;

  @ApiProperty({ format: 'date-time' })
  signedAt!: string;

  @ApiProperty()
  signedWaiverVersion!: number;
}

export class GuestWaiverSignatureListDto {
  @ApiProperty({ type: [GuestWaiverSignatureDto] })
  items!: GuestWaiverSignatureDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class GuestWaiverSignatureDetailDto extends GuestWaiverSignatureDto {
  @ApiProperty()
  signedWaiverTitle!: string;

  @ApiProperty()
  signedWaiverBody!: string;

  @ApiProperty()
  signedWaiverSha256!: string;
}
