import { ApiProperty } from '@nestjs/swagger';

/** Decision 352 — POST /franchises/{id}/schools/{schoolId}/remove. */
export class RemoveFranchiseSchoolResponseDto {
  @ApiProperty()
  schoolId!: string;
}
