import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * GET /schools/:schoolId/branches query — cursor-based pagination (Decision 22/70)
 * plus an optional `city` filter, same extension shape TranslationsQueryDto already
 * established for `GET /translations?screen=&locale=` (PaginationQueryDto subclass,
 * every filter optional/independent).
 *
 * There is no dedicated `city` column on Branch (confirmed against schema.prisma —
 * Decision 76's field list gives Branch only a single free-text `address` field, no
 * structured city/street/postcode breakdown). `city` is therefore a case-insensitive
 * substring match against `Branch.address` (BranchesService.findAllForSchool), not a
 * new column — the honest, additive interpretation of the mockup's "City filter" given
 * what's actually on the model today, not a product decision to invent a new field.
 */
export class BranchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against Branch.address (no dedicated city column exists).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string;

  /** Decision 226 — archived Branches are excluded by default (same
   * "excluded by default, visible via a filter" convention this build applies
   * to every one of the 7 entities); set true to include them too. */
  @ApiPropertyOptional({ default: false, description: 'Include archived Branches too (excluded by default).' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;
}
