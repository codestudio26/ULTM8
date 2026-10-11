import { ApiProperty } from '@nestjs/swagger';
import { StudentStatusDto } from './student-roster-query.dto';

/** A Student roster row — a User holding an (active or revoked) STUDENT RoleGrant at a
 * School. There is no dedicated Students module/entity in this codebase (a Student is
 * a User plus a STUDENT-role RoleGrant, same shape Instructors' own eligible-users
 * endpoint already establishes for INSTRUCTOR); see
 * SchoolsService.findAllStudentsForSchool. */
export class StudentSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  /** When this Student's enrollment at this School began — RoleGrant.grantedAt, not
   * User.createdAt (which is account creation, not enrollment). For an ACTIVE
   * Student, the earliest currently-non-revoked grant's date (unchanged from this
   * field's pre-existing meaning); for an INACTIVE Student (every grant revoked),
   * the most recent grant's date instead, since there is no "current" one. */
  @ApiProperty()
  enrolledAt!: string;

  /** ACTIVE = holds at least one non-revoked STUDENT RoleGrant at this School;
   * INACTIVE = holds only revoked ones. Resolved server-side — never ALL, which is
   * only a request-side filter value (StudentRosterStatusDto), not a row status. */
  @ApiProperty({ enum: StudentStatusDto, enumName: 'StudentStatus' })
  status!: StudentStatusDto;
}

export class StudentListResponseDto {
  @ApiProperty({ type: [StudentSummaryResponseDto] })
  items!: StudentSummaryResponseDto[];
}
