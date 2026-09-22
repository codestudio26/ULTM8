import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape — see class-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`, without which
 * openapi-typescript silently generates `Record<string, never>` for it). Field-for-field
 * match of the Instructor Prisma model.
 */
export class InstructorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  /** Resolved via PrismaAuthService (see resolveUserNames.ts) — not a raw Instructor
   * column. Added so the Instructors list and any picker built on it can show a real
   * name instead of a truncated userId or the beltRanking text standing in for one. */
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  photoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  beltRanking!: string | null;

  @ApiProperty({ type: [String] })
  specializations!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  yearsOfExperience!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bio!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class InstructorListResponseDto {
  @ApiProperty({ type: [InstructorResponseDto] })
  items!: InstructorResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
