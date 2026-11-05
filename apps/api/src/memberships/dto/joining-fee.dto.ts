import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** GET /membership-plans/{id}/joining-fee — `studentId`: a parent asking for
 * their child, or staff at the desk asking for a member. Omit for yourself. */
export class JoiningFeeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

/** Decision 435 items 1-6: the joining fee a payment for this plan by this
 * member would carry now (their first-ever plan at the School, with the
 * School's joining fees on), so the app and the desk show it before paying. */
export class JoiningFeeResponseDto {
  @ApiProperty({ description: "The joining fee added to this payment, in the plan's minor units. 0 = none (not a first plan, no fee on the plan, or the School's joining fees are off)." })
  joiningFee!: number;

  @ApiProperty({ description: 'Whether that fee is refunded together with the membership payment.' })
  refundable!: boolean;

  @ApiProperty({ description: 'Paid by card in the app only: the card surcharge the joining fee adds to this payment (Decision 406), in the same minor units. 0 when none. Never at the desk.' })
  cardSurchargeAmount!: number;
}
