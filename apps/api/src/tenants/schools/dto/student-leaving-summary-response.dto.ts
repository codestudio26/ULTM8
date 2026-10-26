import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One membership still in effect for a student who is about to be revoked. */
export class LeavingStudentMembershipDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  planTitle!: string;

  @ApiProperty({ enum: ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'FRIEND_PASS', 'TRIAL_MEMBERSHIP'] })
  type!: string;

  /** Class Pack / Friend Pass credits left; null for general access. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  classesRemaining!: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  expiryDate!: Date | null;

  /** A Stripe Subscription that keeps charging until it is cancelled. */
  @ApiProperty()
  renews!: boolean;
}

/** What is still live for a student at this School, shown in the Revoke
 * dialog before the owner confirms (Decision 343, S2). */
export class StudentLeavingSummaryResponseDto {
  /** Upcoming bookings Revoke will cancel. */
  @ApiProperty()
  upcomingBookings!: number;

  /** Waitlist places Revoke will remove. */
  @ApiProperty()
  waitlistPlaces!: number;

  /** Memberships still in effect. Revoke doesn't refund them. */
  @ApiProperty({ type: [LeavingStudentMembershipDto] })
  memberships!: LeavingStudentMembershipDto[];
}
