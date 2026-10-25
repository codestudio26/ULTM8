import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimSearch } from '../../../common/search/name-search';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { FeeModelDto } from './create-franchise.dto';

/**
 * GET /franchises query — cursor-based pagination (Decision 22/70) plus two optional,
 * independent filters (School Portal's Franchises page Fee model / Activity filters),
 * same extension shape TranslationsQueryDto already established for
 * `GET /translations?screen=&locale=` (PaginationQueryDto subclass).
 *
 * `feeModel` is an exact match against the real `Franchise.feeModel` enum column.
 * `activity` is an exact match against one element of `Franchise.activities`
 * (String[], free text — domain-rules §4's own unreconciled "activities" caveat, so
 * this deliberately doesn't attempt fuzzy/case-insensitive matching on array elements,
 * unlike `city`'s substring match on Branch.address above: there's no Prisma
 * `mode: 'insensitive'` support for array-contains, and the values populating this
 * filter's own options come from the School's already-stored activities, not free
 * typing, so an exact match is the correct, not merely simplest, behavior).
 */
export class FranchisesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FeeModelDto })
  @IsOptional()
  @IsEnum(FeeModelDto)
  feeModel?: FeeModelDto;

  @ApiPropertyOptional({ description: 'Exact match against one element of Franchise.activities.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  activity?: string;

  /** Decision 278 — the header Global Search: case-insensitive substring match against
   * `Franchise.name`. Trimmed; blank means no filter. Same length limit as ClassesQueryDto.search. */
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against Franchise.name.' })
  @IsOptional()
  @Transform(({ value }) => trimSearch(value))
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Decision 278 — leave archived (closed) Franchises out. Defaults to false, so a
   * request without it lists archived Franchises exactly as before. Parsed
   * explicitly rather than with `@Type(() => Boolean)`, which reads the string
   * "false" as true; anything other than true/false is rejected by @IsBoolean. */
  @ApiPropertyOptional({ default: false, description: 'Leave archived Franchises out (they are listed by default).' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  excludeArchived?: boolean;
}
