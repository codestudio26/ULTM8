import { ApiProperty } from '@nestjs/swagger';

/** One roster row — a real Student (from `SchoolsService.findAllStudentsForSchool`,
 * the same roster Instructor/Student picker endpoints already use) diffed
 * against this Waiver's own `WaiverSignature` rows (Decision 214: diff
 * against the real roster, not an explicit Pending row). `status`/`signedDate`/
 * `signatureId` are null-equivalent ('UNSIGNED'/null/null) when the Student
 * has never signed — synthesized, not a stored row. */
export class WaiverSignatureRosterItemDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['SIGNED', 'UNSIGNED', 'EXPIRED', 'PENDING'] })
  status!: 'SIGNED' | 'UNSIGNED' | 'EXPIRED' | 'PENDING';

  @ApiProperty({ type: String, nullable: true })
  signedDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  signatureId!: string | null;
}

export class WaiverSignatureRosterResponseDto {
  @ApiProperty()
  waiverId!: string;

  @ApiProperty()
  signedCount!: number;

  @ApiProperty()
  totalCount!: number;

  @ApiProperty({ type: [WaiverSignatureRosterItemDto] })
  items!: WaiverSignatureRosterItemDto[];
}
