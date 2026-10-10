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
