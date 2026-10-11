import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response shape — see school-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type`). Field-for-field match of the Branch
 * Prisma model (Decision 76's field list, extended by Decision 238). */
export class BranchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  type!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactPhone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'IANA timezone name.' })
  timezone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  currencyOverride!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultLanguage!: string | null;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiProperty({ type: [String] })
  facilities!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

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
