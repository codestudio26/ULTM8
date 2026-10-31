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
   * the Students page shows "Managed by a Guardian" for the email (Decision 341). */
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

  /** Decision 315 item 4 (backlog 5.1): the day they joined this School,
   * YYYY-MM-DD — the day they were added unless staff set an earlier one.
   * The Students list's "Joined" column. Null only for a row with none. */
  @ApiPropertyOptional({ type: String, nullable: true, description: 'YYYY-MM-DD: the day they joined this School.' })
  joinedOn!: string | null;

  /** ACTIVE = holds at least one non-revoked STUDENT RoleGrant at this School;
   * INACTIVE = holds only revoked ones. Resolved server-side — never ALL, which is
   * only a request-side filter value (StudentRosterStatusDto), not a row status. */
  @ApiProperty({ enum: StudentStatusDto, enumName: 'StudentStatus' })
  status!: StudentStatusDto;

  /** The student's home branch at this School (Decision 371, Students Q2).
   * Null at a School with no branches, for a former student, or for a row the
   * caller can't see the home branch of. */
  @ApiPropertyOptional({ type: String, nullable: true })
  homeBranchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  homeBranchName!: string | null;

  /** Decision 391: has had a visit pass and no membership since. */
  @ApiProperty()
  visitor!: boolean;

  /** When the Visitor's last visit pass ends (past once it has ended). Null for a member. */
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  visitPassEndsAt!: Date | null;

  @ApiProperty({ description: 'Decision 404: a membership of theirs is frozen today.' })
  frozen!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 404: the day they are back (YYYY-MM-DD) when frozen.' })
  frozenUntil!: string | null;
}

export class StudentListResponseDto {
  @ApiProperty({ type: [StudentSummaryResponseDto] })
  items!: StudentSummaryResponseDto[];
}
