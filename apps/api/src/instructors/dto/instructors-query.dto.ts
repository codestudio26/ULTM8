import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimSearch } from '../../common/search/name-search';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Decision 226 — `GET /schools/:schoolId/instructors` gains `includeArchived`
 * (same "excluded by default, visible via a filter" convention applied to
 * every one of the 7 entities this build covers). */
export class InstructorsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: false, description: 'Include archived Instructor profiles too (excluded by default).' })
  @IsOptional()
  // "false" is a non-empty string, which @Type(() => Boolean) read as true (Waivers review W11).
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  includeArchived?: boolean;

  /** Decision 278 — the header Global Search: case-insensitive substring match against
   * the Instructor's first name, surname, or full name "first surname". Trimmed; blank means no filter. Same length limit as ClassesQueryDto.search. */
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against first name, surname, or full name ("first surname").' })
  @IsOptional()
  @Transform(({ value }) => trimSearch(value))
  @IsString()
  @MaxLength(200)
  search?: string;
}
