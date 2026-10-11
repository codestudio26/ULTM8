import { ApiProperty } from '@nestjs/swagger';

/** A Student roster row — a User holding a STUDENT RoleGrant at a School, active or
 * not (v1.2 backend backlog — Active/Inactive/All filtering). There is no dedicated
 * Students module/entity in this codebase (a Student is a User plus a STUDENT-role
 * RoleGrant, same shape Instructors' own eligible-users endpoint already establishes
 * for INSTRUCTOR); see SchoolsService.findAllStudentsForSchool. */
export class StudentSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  /** The enrollment this row reflects: the current one if ACTIVE, else the most
   * recently revoked one. RoleGrant.grantedAt, not User.createdAt (which is account
   * creation, not enrollment). */
  @ApiProperty()
  enrolledAt!: string;

  /** ACTIVE = currently holds a non-revoked STUDENT RoleGrant at this School;
   * INACTIVE = held one in the past but it's since been revoked. A User who was
   * revoked and later re-enrolled reads ACTIVE — resolved from their CURRENT state,
   * not "has ever held a revoked row". */
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: 'ACTIVE' | 'INACTIVE';
}

export class StudentListResponseDto {
  @ApiProperty({ type: [StudentSummaryResponseDto] })
  items!: StudentSummaryResponseDto[];
}
