import { ApiProperty } from '@nestjs/swagger';

/** GET /timetable/:id/upcoming-impact (Decision 322). */
export class UpcomingImpactResponseDto {
  @ApiProperty({ description: 'Upcoming, unarchived Classes generated from this slot.' })
  upcomingClasses!: number;

  @ApiProperty({ description: 'Of those, how many have bookings or a waitlist.' })
  bookedClasses!: number;

  @ApiProperty({ description: 'Students (and guests) booked across those Classes.' })
  bookedStudents!: number;
}
