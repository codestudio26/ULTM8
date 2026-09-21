import { ApiProperty } from '@nestjs/swagger';

/** A Student roster row — a User holding an active STUDENT RoleGrant at a School.
 * There is no dedicated Students module/entity in this codebase (a Student is a User
 * plus a STUDENT-role RoleGrant, same shape Instructors' own eligible-users endpoint
 * already establishes for INSTRUCTOR); see SchoolsService.findAllStudentsForSchool. */
export class StudentSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  /** When this Student's (currently active) enrollment at this School began —
   * RoleGrant.grantedAt, not User.createdAt (which is account creation, not
   * enrollment). */
  @ApiProperty()
  enrolledAt!: string;
}

export class StudentListResponseDto {
  @ApiProperty({ type: [StudentSummaryResponseDto] })
  items!: StudentSummaryResponseDto[];
}
