import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * `GET /schools/:schoolId/branches` filter params (v1.2 backend backlog's
 * "City filter — client-side only; no filter query param exists"). `Branch`
 * has no structured `city` column — only the free-text `address` field
 * (confirmed against schema.prisma before building this, not assumed) — so
 * this is a case-insensitive substring match against `address`, not a
 * dropdown over a controlled city list. Flagging the interpretation, not
 * silently assuming it: a real `city` field is its own, separate schema
 * decision this doesn't make.
 */
export class FindBranchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against address (the only real location field Branch has — see this file\'s own header comment).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}
