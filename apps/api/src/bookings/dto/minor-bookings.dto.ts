import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A parent booking for their child in the app: the Schools the child is a
 * student at, and the child's upcoming bookings. */

export class MinorSchoolDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;
}

export class MinorSchoolListDto {
  @ApiProperty({ type: [MinorSchoolDto] })
  items!: MinorSchoolDto[];
}

export class MinorBookingDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  classTitle!: string;

  @ApiProperty({ format: 'date-time' })
  classStartsAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 427 (SP6): the IANA time zone the class runs on (its Branch's, else its School's); null when neither is set." })
  classTimezone!: string | null;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ description: 'Guests on the booking, one Friend Pass each.' })
  guestCount!: number;
}

export class MinorBookingListDto {
  @ApiProperty({ type: [MinorBookingDto], description: 'Upcoming bookings, soonest first.' })
  items!: MinorBookingDto[];
}
