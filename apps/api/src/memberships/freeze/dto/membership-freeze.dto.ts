import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Decision 404: a freeze's dates, calendar days in the School's time zone. */
export class CreateMembershipFreezeDto {
  @ApiProperty({ example: '2026-11-02', description: 'The first frozen day (YYYY-MM-DD), today or later.' })
  @Matches(DAY, { message: 'startsAt must be a date like 2026-11-02.' })
  startsAt!: string;

  @ApiProperty({ example: '2026-11-30', description: 'The day the member is back (YYYY-MM-DD, not frozen itself). At least 7 days after startsAt.' })
  @Matches(DAY, { message: 'endsAt must be a date like 2026-11-30.' })
  endsAt!: string;
}

export class MembershipFreezeListQueryDto {
  @ApiPropertyOptional({ enum: ['REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED'], description: 'Only freezes with this status. Omitted: every status.' })
  @IsOptional()
  @IsIn(['REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED'])
  status?: 'REQUESTED' | 'APPROVED' | 'DECLINED' | 'CANCELLED';
}

/** The freeze a membership's screens show (Decision 404). */
export class FreezeSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['REQUESTED', 'APPROVED'] })
  status!: 'REQUESTED' | 'APPROVED';

  @ApiProperty({ description: 'The first frozen day (YYYY-MM-DD).' })
  startsAt!: string;

  @ApiProperty({ description: 'The day the member is back (YYYY-MM-DD), moved earlier when the freeze was ended early.' })
  endsAt!: string;
}

/** One freeze or freeze request (Decision 404). */
export class MembershipFreezeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  membershipId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty({ description: 'The first frozen day (YYYY-MM-DD).' })
  startsAt!: string;

  @ApiProperty({ description: 'The day the member is back as asked (YYYY-MM-DD, exclusive).' })
  endsAt!: string;

  @ApiProperty({ description: 'The day the member is back, moved earlier when ended early (YYYY-MM-DD).' })
  backOn!: string;

  @ApiProperty({ enum: ['REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED'] })
  status!: 'REQUESTED' | 'APPROVED' | 'DECLINED' | 'CANCELLED';

  @ApiProperty({ description: 'An approved freeze covers today.' })
  frozenNow!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  endedEarlyAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  requestedById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  decidedById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  decidedAt!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The fee charged when approved, in minor units.' })
  feeAmount!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  feeTransactionId!: string | null;

  @ApiProperty()
  createdAt!: string;
}

/** A freeze in the owner's list, with who and which plan. */
export class SchoolMembershipFreezeResponseDto extends MembershipFreezeResponseDto {
  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty()
  studentSurname!: string;

  @ApiProperty()
  planTitle!: string;

  @ApiProperty()
  planType!: string;
}

export class SchoolMembershipFreezeListResponseDto {
  @ApiProperty({ type: [SchoolMembershipFreezeResponseDto] })
  items!: SchoolMembershipFreezeResponseDto[];
}

/** A membership the caller, or their child, may ask to freeze (Decision 404). */
export class MyFreezableMembershipDto {
  @ApiProperty()
  membershipId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty({ description: "The caller's own membership (false: a Guardian's child's)." })
  self!: boolean;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiProperty()
  planTitle!: string;

  @ApiProperty()
  planType!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  expiryDate!: string | null;

  @ApiProperty({ description: 'An approved freeze covers today.' })
  frozen!: boolean;

  @ApiPropertyOptional({ type: FreezeSummaryDto, nullable: true })
  freeze!: FreezeSummaryDto | null;

  @ApiProperty({ description: "The School's most frozen days in any 12 months." })
  maxDaysPer12Months!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "The School's freeze fee in minor units; null = none." })
  feeAmount!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty({ description: "Today in the School's time zone (YYYY-MM-DD): the earliest start." })
  today!: string;
}

export class MyFreezableMembershipListResponseDto {
  @ApiProperty({ type: [MyFreezableMembershipDto] })
  items!: MyFreezableMembershipDto[];
}
