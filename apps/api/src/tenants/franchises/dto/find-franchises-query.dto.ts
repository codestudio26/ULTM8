import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { FeeModelDto } from './create-franchise.dto';

/**
 * `GET /franchises` filter params (v1.2 backend backlog's "Fee model /
 * Activity filters — client-side only; no filter query param exists").
 * Both map directly to real, structured Franchise columns (`feeModel`
 * enum, `activities` array) — no interpretation needed, unlike Branch's
 * address-based "city" filter (find-branches-query.dto.ts).
 */
export class FindFranchisesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FeeModelDto })
  @IsOptional()
  @IsEnum(FeeModelDto)
  feeModel?: FeeModelDto;

  @ApiPropertyOptional({ description: 'Only Franchises whose activities list includes this exact value.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  activity?: string;
}
