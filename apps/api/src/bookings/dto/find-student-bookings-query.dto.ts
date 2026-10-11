import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** GET students/:id/bookings's own query shape. `schoolId` is required, not
 * optional — same reasoning MembershipsService.getMembershipStatus's own
 * `schoolId` query param already established: a Student may be enrolled at
 * more than one School, so Booking (School-scoped) needs to know which one. */
export class FindStudentBookingsQueryDto extends PaginationQueryDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;
}
