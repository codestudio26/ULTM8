import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

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

/** POST /schools/{schoolId}/students/{studentId}/memberships/gift — the owner
 * gives a Student a Friend Pass to bring one guest (Spec 55 §6.1: School-gifted,
 * always £0, staff-attributed). */
export class GiftFriendPassDto {
  @ApiProperty()
  @IsUUID()
  membershipPlanId!: string;
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
