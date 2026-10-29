import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** GET /schools/:id/franchise-fee/card (Decision 407). brand/last4 are read
 * live from Stripe, never stored — absent when there is no card, or the saved
 * payment method isn't a card. */
export class FranchiseFeeCardResponseDto {
  @ApiProperty({ description: "False while the School's Franchise hasn't connected Stripe: no card can be added yet." })
  canAddCard!: boolean;

  @ApiProperty()
  hasCard!: boolean;

  @ApiPropertyOptional()
  brand?: string;

  @ApiPropertyOptional()
  last4?: string;
}
