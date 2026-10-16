import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Decision 266 — `GET /public/schools/search?q=`. Extends (not intersects)
 * PaginationQueryDto so class-validator's decorators on both actually run —
 * a `&` type-intersection of two DTO classes doesn't carry the other
 * class's decorators onto the merged shape. */
export class SchoolSearchQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'School name, partial match, case-insensitive.' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;
}
