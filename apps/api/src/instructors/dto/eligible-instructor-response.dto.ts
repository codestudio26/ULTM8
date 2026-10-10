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
}

export class EligibleInstructorListResponseDto {
  @ApiProperty({ type: [EligibleInstructorUserDto] })
  items!: EligibleInstructorUserDto[];
}
