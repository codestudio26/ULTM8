import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Minimum-fields response for the exact-match invite lookup (Decision 116) — lets
 * StaffPage's invite form show "Found: Jane Doe — invite this person?" before
 * create() actually fires. `found: false` means every other field is null. */
export class InviteCandidateResponseDto {
  @ApiProperty()
  found!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  id!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  firstName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  surname!: string | null;

  /** v1.2 backlog (Instructor/Student Invite) — the mockups' "Found: {name}" card and
   * "an invite would be sent to {{candidateEmail}}" copy need a real email this
   * endpoint didn't previously return. */
  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;
}
