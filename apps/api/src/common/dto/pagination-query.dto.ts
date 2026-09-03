import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Cursor-based pagination request shape (`?cursor=&limit=`) — confirmed platform-wide
 * convention for every list endpoint, not offset/page pagination (Decision 22,
 * ultm8-nestjs-module §2). The `nextCursor`/`items` response envelope this pairs with
 * (see common/pagination/cursor-paginate.ts) is a Developer-level choice — Decision 22
 * confirms the query-param shape and the "cursor, not offset" requirement, not a
 * specific response envelope — flagged for Architect review same as other
 * reasonable-minimum additions in this codebase (e.g. AuthModule's phoneVerifiedAt).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page\'s nextCursor.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
