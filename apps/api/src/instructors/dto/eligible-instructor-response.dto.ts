import { ApiProperty } from '@nestjs/swagger';

/** A User holding an active INSTRUCTOR RoleGrant at a School — the candidate pool for
 * InstructorFormModal's picker (Decision 115). Not a RoleGrant or Instructor row itself;
 * see InstructorsService.findEligibleInstructorUsers. */
export class EligibleInstructorUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  /** Included to disambiguate same-name candidates in the picker UI. */
  @ApiProperty()
  email!: string;

  /** Their Instructor role covers the whole School (Decision 311). */
  @ApiProperty()
  schoolWide!: boolean;

  /** The branches their Instructor role is for, when not the whole School. */
  @ApiProperty({ type: [String] })
  branchIds!: string[];
}

export class EligibleInstructorListResponseDto {
  @ApiProperty({ type: [EligibleInstructorUserDto] })
  items!: EligibleInstructorUserDto[];
}
