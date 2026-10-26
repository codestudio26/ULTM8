import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trimSearch } from '../../common/search/name-search';

/**
 * GET /schools/:schoolId/classes query — cursor-based pagination (Decision 22/70,
 * `ClassListResponseDto.nextCursor`, already real) plus two optional, independent
 * filters (School Portal's Classes page Discipline filter + "Search classes" box),
 * same extension shape TranslationsQueryDto already established for
 * `GET /translations?screen=&locale=` (PaginationQueryDto subclass).
 *
 * `activities` is an exact match against one element of `Class.activities`
 * (String[] — same free-text-tag caveat as FranchisesQueryDto's own `activity` filter;
 * no case-insensitive array-contains support in Prisma, and the filter's own options
 * come from the School's already-stored activities, not free typing).
 *
 * `search` is a case-insensitive substring match against `Class.title` — this
 * codebase has no pre-existing text-search query param on any list endpoint to match
 * (confirmed: no `contains` usage anywhere in apps/api/src before this), so this uses
 * the same Prisma `contains` + `mode: 'insensitive'` idiom `city`/`activity` above
 * follow, rather than inventing a different convention for free-text search.
 */
export class ClassesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Exact match against one element of Class.activities.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  activities?: string;

  /** Trimmed; blank means no filter (Decision 278, same as the other list endpoints' `search`). */
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against Class.title.' })
  @IsOptional()
  @Transform(({ value }) => trimSearch(value))
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Decision 226 — archived Classes are excluded by default. */
  @ApiPropertyOptional({ default: false, description: 'Include archived Classes too (excluded by default).' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  /** "Log a class" on the student's Ranks tab (Decision 301 item 5): the
   * classes of one style, the ones the coach can pick. */
  @ApiPropertyOptional({ description: 'Only Classes that list this style (Class.styles).' })
  @IsOptional()
  @IsUUID()
  disciplineId?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time: only Classes starting at or after it.' })
  @IsOptional()
  @IsISO8601()
  startsFrom?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time: only Classes starting at or before it.' })
  @IsOptional()
  @IsISO8601()
  startsTo?: string;

  /** Classes review C3: `upcoming` (not yet ended, soonest first), `past`
   * (ended, latest first) or `all` (latest first). Omitted keeps the old
   * id order, for callers that read the whole list (e.g. plan scoping). */
  @ApiPropertyOptional({ enum: ['upcoming', 'past', 'all'], description: 'Date view, sorted by start time. Omit for the unsorted list.' })
  @IsOptional()
  @IsIn(['upcoming', 'past', 'all'])
  when?: 'upcoming' | 'past' | 'all';

  /** Classes review C17: only Classes this User teaches (coach dashboard). */
  @ApiPropertyOptional({ description: 'Only Classes taught by this User.' })
  @IsOptional()
  @IsUUID()
  instructorId?: string;
}
