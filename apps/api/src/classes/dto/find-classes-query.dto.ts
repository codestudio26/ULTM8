import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * `GET /schools/:schoolId/classes` filter params (v1.2 backend backlog's
 * "Discipline filter" and "Search box" — neither had a query param
 * before this). `activity` is an exact match against an entry in the
 * real `Class.activities` array (same shape as Franchise's own
 * `activity` filter, find-franchises-query.dto.ts); `search` is a
 * case-insensitive substring match against `Class.title`, the only real
 * free-text field a "Search classes" box could plausibly search.
 */
export class FindClassesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only Classes whose activities list includes this exact value.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  activity?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive substring match against title.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
