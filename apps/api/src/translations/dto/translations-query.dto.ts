import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** GET /translations query — cursor-based pagination (Decision 22/70, platform-wide
 * convention) plus the two confirmed filters (ultm8-nestjs-module §5:
 * `GET /translations?locale=&screen=`). Both filters are optional and independent —
 * a caller can filter by screen alone (e.g. rendering one screen's full copy),
 * locale alone, both together, or neither (browsing everything, the shape the future
 * apps/platform-admin authoring UI needs — see TranslationsService's own header
 * comment for why no separate admin list endpoint exists). */
export class TranslationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  screen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  locale?: string;
}
