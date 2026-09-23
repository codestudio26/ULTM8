import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

/** Request body for POST /franchise-fee-charges/:id/refund. `amount` omitted
 * means "refund whatever hasn't been refunded yet" — see
 * FranchiseFeesService.refund()'s own comment for the full account. */
export class RefundFranchiseFeeChargeDto {
  @ApiPropertyOptional({ description: 'Minor-unit (e.g. cents). Omit to refund the full remaining unrefunded balance.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;
}
