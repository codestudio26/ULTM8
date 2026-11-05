import { ApiProperty } from '@nestjs/swagger';

/** One coach or Branch Staff role (Decision 432 item 6). */
export class SchoolStaffRoleDto {
  @ApiProperty({ enum: ['INSTRUCTOR', 'BRANCH_STAFF'] })
  role!: string;

  @ApiProperty({ type: String, nullable: true })
  branchName!: string | null;
}

/** GET /platform-admin/schools/{id}/staff (Decision 432 item 6). */
export class SchoolStaffMemberDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: [SchoolStaffRoleDto] })
  roles!: SchoolStaffRoleDto[];

  @ApiProperty({ description: 'Every one of their coach and Branch Staff roles here is paused.' })
  paused!: boolean;
}

export class SchoolStaffResponseDto {
  @ApiProperty({ type: [SchoolStaffMemberDto] })
  items!: SchoolStaffMemberDto[];
}

/** POST /platform-admin/schools/{id}/staff/{userId}/pause. */
export class PauseSchoolStaffResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  pausedRoles!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  pausedAt!: string;
}
