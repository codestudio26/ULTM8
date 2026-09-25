import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape for the four TenantLifecycleModule endpoints (close/reactivate
 * x School/Franchise) — deliberately its own small DTO, not a reuse of
 * SchoolResponseDto/FranchiseResponseDto. Those two are field-for-field matches
 * of their whole Prisma model and are already relied on elsewhere (tenant-side
 * create/update responses, existing e2e assertions); widening either one to
 * carry archivedAt/purgeAt/purgedAt is a separate, broader change this phase
 * doesn't need to make. These four actions only ever change the lifecycle
 * columns, so returning just those (plus the id) is a complete, accurate answer
 * to "what did this action do."
 */
export class TenantLifecycleStatusDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO timestamp this School/Franchise was closed, or null if active.' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO timestamp the 90-day retention window elapses, or null if active.' })
  purgeAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO timestamp the scheduled purge job actually processed this row, or null if not yet purged.' })
  purgedAt!: string | null;
}
