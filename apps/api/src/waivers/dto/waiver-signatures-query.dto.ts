import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { trimSearch } from '../../common/search/name-search';

export const WAIVER_SIGNATURE_FILTERS = ['signed', 'unsigned'] as const;
export type WaiverSignatureFilter = (typeof WAIVER_SIGNATURE_FILTERS)[number];

/** GET /schools/{schoolId}/waivers/{id}/signatures (Decision 418):
 * one page at a time, with the panel's tab and search done on the server. */
export class WaiverSignaturesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: WAIVER_SIGNATURE_FILTERS,
    description: 'signed = SIGNED only; unsigned = everything not SIGNED (Unsigned, Pending, Expired). Leave out for everyone.',
  })
  @IsOptional()
  @IsIn(WAIVER_SIGNATURE_FILTERS)
  filter?: WaiverSignatureFilter;

  @ApiPropertyOptional({ description: 'Part of the student\'s name or the name typed when signing; capitals and accents ignored.' })
  @IsOptional()
  @Transform(({ value }) => trimSearch(value))
  @IsString()
  @MaxLength(100)
  q?: string;
}
