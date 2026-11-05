import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** How a desk sale was paid. Never STRIPE: a card payment through Stripe
 * goes through checkout, not the desk. */
export const DESK_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'PIX', 'CARD_TERMINAL'] as const;
export type DeskPaymentMethod = (typeof DESK_PAYMENT_METHODS)[number];

/** POST /schools/{schoolId}/students/{studentId}/memberships/sell — the
 * owner records a plan sold at the desk, already paid in cash, by bank
 * transfer, by Pix or on the School's own card terminal (Decision 348). Not for a Subscription (card only, Spec 55 §6.1)
 * or a Friend Pass (given, not sold: see GiftFriendPassDto). */
export class SellMembershipDto {
  @ApiProperty()
  @IsUUID()
  membershipPlanId!: string;

  @ApiProperty({ enum: DESK_PAYMENT_METHODS })
  @IsIn(DESK_PAYMENT_METHODS)
  paymentMethod!: DeskPaymentMethod;
}

/** Decision 431 (MON-15): the most Friend Passes given in one action. */
export const MAX_FRIEND_PASSES_AT_ONCE = 5;

/** POST /schools/{schoolId}/students/{studentId}/memberships/gift — the owner
 * gives a Student a Friend Pass to bring one guest (Spec 55 §6.1: School-gifted,
 * always £0, staff-attributed). */
export class GiftFriendPassDto {
  @ApiProperty()
  @IsUUID()
  membershipPlanId!: string;

  /** Decision 431 (MON-15): give several passes in one action (one per guest),
   * so a second pass doesn't have to wait out the repeat guard. */
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_FRIEND_PASSES_AT_ONCE, default: 1, description: 'Decision 431 (MON-15): how many Friend Passes to give at once (1-5).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_FRIEND_PASSES_AT_ONCE)
  quantity?: number;
}

/** POST /memberships/{id}/cancel. `studentId` is only for a Guardian
 * cancelling a linked minor's Subscription, the same on-behalf-of shape as
 * PurchaseMembershipDto. */
export class CancelMembershipDto {
  @ApiPropertyOptional({ description: 'Guardian-only: the linked minor whose Subscription this is.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
