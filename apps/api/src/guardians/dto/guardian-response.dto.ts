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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'When a School confirmed this link (Decision 172). Consent can be granted only once this is set.',
  })
  confirmedAt!: string | null;
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

  @ApiProperty({
    description:
      'Whether policyVersion is the privacy notice version currently published (Decision 171). False means the Guardian should be asked to consent again.',
  })
  isCurrentPolicyVersion!: boolean;
}

export class ConsentRecordListResponseDto {
  @ApiProperty({ type: [ConsentRecordResponseDto] })
  items!: ConsentRecordResponseDto[];
}

/** Decision 170 — one entry in a Guardian's append-only consent history. */
export class ConsentEventResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  consentRecordId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty({ enum: ['BASELINE', 'CAMERA'] })
  tier!: string;

  @ApiProperty({ enum: ['GRANTED', 'WITHDRAWN'] })
  type!: string;

  @ApiProperty()
  policyVersion!: string;

  @ApiProperty()
  parentalResponsibilityDeclared!: boolean;

  @ApiProperty({ description: 'Reconstructed from a consent that existed before history was kept (Decision 170).' })
  backfilled!: boolean;

  @ApiProperty()
  occurredAt!: string;
}

export class ConsentEventListResponseDto {
  @ApiProperty({ type: [ConsentEventResponseDto] })
  items!: ConsentEventResponseDto[];
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
