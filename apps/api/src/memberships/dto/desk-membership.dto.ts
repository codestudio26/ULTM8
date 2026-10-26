import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** POST /schools/{schoolId}/students/{studentId}/memberships/sell — the
 * owner records a plan sold at the desk, already paid in cash or by bank
 * transfer (Decision NNN). Not for a Subscription (card only, Spec 55 §6.1)
 * or a Friend Pass (given, not sold: see GiftFriendPassDto). */
export class SellMembershipDto {
  @ApiProperty()
  @IsUUID()
  membershipPlanId!: string;

  @ApiProperty({ enum: ['CASH', 'BANK_TRANSFER'] })
  @IsIn(['CASH', 'BANK_TRANSFER'])
  paymentMethod!: 'CASH' | 'BANK_TRANSFER';
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
