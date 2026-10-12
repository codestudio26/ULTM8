import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shape — see school-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type`). Field-for-field match of the Branch
 * Prisma model (Decision 76's field list, plus Decision 231's four additions). */
export class BranchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactPhone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'IANA timezone name.' })
  timezone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  currencyOverride!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  type!: string | null;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiProperty({ type: [String] })
  facilities!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultLanguage!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — set when this Branch has been archived. Null when active.' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — 90 days after archivedAt; the scheduled purge sweep hard-deletes this Branch once this elapses (unless blocked by a FK, logged and retried).' })
  purgeAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — set by the purge sweep once actually purged. Always null in practice for a successfully-deleted row (the row itself is gone); kept for API shape consistency with School/Franchise.' })
  purgedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class BranchListResponseDto {
  @ApiProperty({ type: [BranchResponseDto] })
  items!: BranchResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
