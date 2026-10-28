import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ description: 'Guests on the booking, one Friend Pass each.' })
  guestCount!: number;
}

export class MinorBookingListDto {
  @ApiProperty({ type: [MinorBookingDto], description: 'Upcoming bookings, soonest first.' })
  items!: MinorBookingDto[];
}
