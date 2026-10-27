import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Decision 226 — `GET /schools/:schoolId/timetable` gains `includeArchived`
 * (same "excluded by default, visible via a filter" convention applied to
 * every one of the 7 entities this build covers); every other field is
 * PaginationQueryDto's own, unchanged. */
export class TimetableQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: false, description: 'Include archived TimetableSlots too (excluded by default).' })
  @IsOptional()
  // "false" is a non-empty string, which @Type(() => Boolean) read as true (Waivers review W11).
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  includeArchived?: boolean;
}
