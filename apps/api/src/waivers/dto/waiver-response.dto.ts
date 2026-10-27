import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the Waiver Prisma model. */
export class WaiverResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — set when this Waiver has been archived. Null when active.' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 226 — 90 days after archivedAt. UNLIKE the other 6 entities, a Waiver is NEVER hard-purged once this elapses (legal-record exception, mirroring Decision 110's own School-level purge carve-out) — it stays archived forever." })
  purgeAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — always null in practice for Waiver; kept for API shape consistency with the other 6 entities.' })
  purgedAt!: string | null;

  @ApiProperty({ description: 'Goes up by one each time the title or text changes. Send it back as SignWaiverDto.waiverVersion.' })
  version!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class WaiverListResponseDto {
  @ApiProperty({ type: [WaiverResponseDto] })
  items!: WaiverResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
