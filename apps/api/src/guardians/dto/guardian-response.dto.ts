import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MinorResponseDto {
  @ApiProperty()
  linkId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  dateOfBirth!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  gender!: string | null;

  @ApiPropertyOptional({ description: 'Decision 430 item 4: true when this child was already on the account (same name and date of birth), so nothing new was added.' })
  alreadyAdded?: boolean;

  @ApiPropertyOptional({
    enum: ['NOT_NEEDED', 'GIVEN', 'GRANDFATHERED', 'WITHDRAWN', 'PENDING'],
    description: "Decision 430 item 9: the child's BASELINE consent. PENDING and WITHDRAWN block booking and check-in until a parent gives it.",
  })
  consent?: 'NOT_NEEDED' | 'GIVEN' | 'GRANDFATHERED' | 'WITHDRAWN' | 'PENDING';

  @ApiPropertyOptional({ description: 'Decision 430 item 7: the child is 18 now (they make their own account; the parent can pay and read history until parentAccessEndsOn).' })
  isAdult?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'YYYY-MM-DD: the last day a parent can still pay for, and read the history of, a child who is 18.' })
  parentAccessEndsOn?: string | null;
}

export class MinorListResponseDto {
  @ApiProperty({ type: [MinorResponseDto] })
  items!: MinorResponseDto[];
}

export class ConsentRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  guardianId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  tier!: string;

  @ApiProperty()
  policyVersion!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  consentedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  withdrawnAt!: string | null;
}

export class ConsentRecordListResponseDto {
  @ApiProperty({ type: [ConsentRecordResponseDto] })
  items!: ConsentRecordResponseDto[];
}

/** Decision 123 — Guardian Kid Mode. */
export class BookingDelegationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  guardianId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  grantedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  withdrawnAt!: string | null;
}

export class BookingDelegationListResponseDto {
  @ApiProperty({ type: [BookingDelegationResponseDto] })
  items!: BookingDelegationResponseDto[];
}

export class KidModeTokenResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  expiresAt!: string;
}

/** One Booking awaiting the Guardian's Confirm/Cancel after a BookingDelegation
 * withdrawal — deliberately a narrow projection (not the full BookingResponseDto),
 * carrying only what the review screen needs plus `studentId` so the client can
 * target the right linked minor on cancelBooking()'s existing on-behalf-of path. */
export class PendingReviewBookingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  status!: string;
}

export class PendingReviewBookingListResponseDto {
  @ApiProperty({ type: [PendingReviewBookingResponseDto] })
  items!: PendingReviewBookingResponseDto[];
}

/** Decision 430 item 9 — one consent record on the child consent view. `id`
 * is set only on the caller's own records (theirs to withdraw). */
export class ChildConsentRecordDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  id!: string | null;

  @ApiProperty({ enum: ['BASELINE', 'CAMERA'] })
  tier!: 'BASELINE' | 'CAMERA';

  @ApiProperty({ enum: ['ACTIVE', 'WITHDRAWN'] })
  status!: 'ACTIVE' | 'WITHDRAWN';

  @ApiProperty()
  policyVersion!: string;

  @ApiProperty()
  consentedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  withdrawnAt!: string | null;
}

export class ChildConsentGuardianDto {
  @ApiProperty()
  guardianId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isMe!: boolean;

  @ApiProperty({ type: [ChildConsentRecordDto] })
  records!: ChildConsentRecordDto[];
}

export class ChildConsentResponseDto {
  @ApiProperty({ enum: ['NOT_NEEDED', 'GIVEN', 'GRANDFATHERED', 'WITHDRAWN', 'PENDING'] })
  state!: 'NOT_NEEDED' | 'GIVEN' | 'GRANDFATHERED' | 'WITHDRAWN' | 'PENDING';

  @ApiProperty({ type: [ChildConsentGuardianDto] })
  guardians!: ChildConsentGuardianDto[];
}
