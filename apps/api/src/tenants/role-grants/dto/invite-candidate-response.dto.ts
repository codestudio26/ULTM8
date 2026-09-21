import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Minimum-fields response for the exact-match invite lookup (Decision 112) — lets
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
}
