import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WaitlistEntryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  /** Joined from WaitlistEntry.student (a User relation), not a WaitlistEntry
   * column — see WaitlistService.findAllForClass. */
  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty()
  studentSurname!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiProperty()
  position!: number;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  joinedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  notifiedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  claimByDeadline!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  claimedBookingId!: string | null;
}

export class WaitlistEntryListResponseDto {
  @ApiProperty({ type: [WaitlistEntryResponseDto] })
  items!: WaitlistEntryResponseDto[];
}

/** GET /waitlist/me (Decision 427): one of the caller's own live waitlist places. */
export class MyWaitlistEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  classId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  position!: number;

  @ApiProperty({ enum: ['WAITING', 'NOTIFIED'], description: 'NOTIFIED: a spot is free and can be claimed until claimByDeadline.' })
  status!: 'WAITING' | 'NOTIFIED';

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  claimByDeadline!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  classTitle!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  classStartsAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 427 (SP6): the IANA time zone the class runs on (its Branch's, else its School's); null when neither is set." })
  classTimezone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  schoolName!: string | null;
}

export class MyWaitlistListDto {
  @ApiProperty({ type: [MyWaitlistEntryDto] })
  items!: MyWaitlistEntryDto[];
}
