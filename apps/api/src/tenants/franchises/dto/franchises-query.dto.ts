import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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
}
