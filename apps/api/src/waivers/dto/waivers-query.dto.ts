import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * GET /schools/:schoolId/waivers query — fixes a real bug found during PR
 * review: the controller previously bound the whole query string to
 * `PaginationQueryDto` via `@Query() query: PaginationQueryDto` while
 * separately extracting `@Query('includeArchived', ...)` as its own
 * parameter. NestJS's global `ValidationPipe({ forbidNonWhitelisted: true })`
 * validates the WHOLE incoming query string against whatever class
 * `@Query()` is bound to — it does not "subtract" a parameter that is also
 * extracted separately — so any request including `includeArchived` (which
 * the frontend always sends) was rejected outright with "property
 * includeArchived should not exist," breaking the Waivers list page
 * entirely. Same fix shape as every other one of the 7 entities this build
 * covers (see BranchesQueryDto's own `includeArchived` field): a dedicated
 * per-entity query DTO that extends PaginationQueryDto and declares the
 * field, bound as the controller's one and only `@Query()` parameter.
 */
export class WaiversQueryDto extends PaginationQueryDto {
  /** Decision 226 — archived Waivers are excluded by default (same
   * "excluded by default, visible via a filter" convention this build applies
   * to every one of the 7 entities); set true to include them too. */
  @ApiPropertyOptional({ default: false, description: 'Include archived Waivers too (excluded by default).' })
  @IsOptional()
  // "false" is a non-empty string, which @Type(() => Boolean) read as true (Waivers review W11).
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  includeArchived?: boolean;
}
