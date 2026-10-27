import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsISO31661Alpha2, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimSearch } from '../../../common/search/name-search';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * GET /schools/:schoolId/branches query — cursor-based pagination (Decision 22/70)
 * plus optional filters, every one independent.
 *
 * Decision 294: results come back sorted by name (A to Z), and the filters
 * ignore case and accents — see branch-list-filter.ts for why that runs in
 * memory rather than SQL. `nextCursor` is opaque (name + id), no longer a
 * bare Branch id.
 */
export class BranchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Exact city, ignoring case and accents, against the structured address city (Decision 276). A Branch with no structured address matches when its free-text address contains the city.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string;

  @ApiPropertyOptional({ description: 'Decision 294 — Branch name, city or postcode containing this text, ignoring case and accents.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Decision 294 — ISO 3166-1 alpha-2 country code of the structured address.' })
  @IsOptional()
  @IsISO31661Alpha2()
  country?: string;

  /** Decision 226 — archived Branches are excluded by default (same
   * "excluded by default, visible via a filter" convention this build applies
   * to every one of the 7 entities); set true to include them too. */
  @ApiPropertyOptional({ default: false, description: 'Include archived Branches too (excluded by default).' })
  @IsOptional()
  // "false" is a non-empty string, which @Type(() => Boolean) read as true (Waivers review W11).
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  includeArchived?: boolean;

  /** Decision 278 — the header Global Search: case-insensitive substring match against
   * `Branch.name`. Trimmed; blank means no filter. Same length limit as ClassesQueryDto.search. */
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against Branch.name.' })
  @IsOptional()
  @Transform(({ value }) => trimSearch(value))
  @IsString()
  @MaxLength(200)
  search?: string;
}
