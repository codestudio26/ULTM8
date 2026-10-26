import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** POST /instructors/:id/reassign (Decision 312) — hands this instructor's
 * upcoming Classes and active Timetable slots to another instructor. */
export class ReassignInstructorDto {
  @ApiProperty({ description: 'User id of the instructor taking over (Class.instructorId is a User id).' })
  @IsUUID()
  toUserId!: string;
}

export class ReassignInstructorResponseDto {
  @ApiProperty({ description: 'Upcoming Classes moved to the new instructor.' })
  classesMoved!: number;

  @ApiProperty({ description: 'Active Timetable slots moved to the new instructor.' })
  slotsMoved!: number;
}
