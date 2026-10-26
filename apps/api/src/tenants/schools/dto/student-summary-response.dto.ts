import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  /** Empty for a Guardian-managed child, whose account has only a placeholder
   * address (guardianManaged). */
  @ApiProperty()
  email!: string;

  /** A child's account a Guardian manages (GuardiansService.createMinor);
   * the Students page shows "Managed by a Guardian" for the email (Decision 323). */
  @ApiProperty()
  guardianManaged!: boolean;

  /** User.profilePhotoUrl — resolved the same way firstName/surname/email already
   * are for this row (a direct User-row select for an ACTIVE-only roster, or
   * resolveUserNames for the INACTIVE/ALL path; see
   * SchoolsService.findAllStudentsForSchool). Nullable: most Students have no
   * photo set. */
  @ApiPropertyOptional({ type: String, nullable: true })
  profilePhotoUrl!: string | null;

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
