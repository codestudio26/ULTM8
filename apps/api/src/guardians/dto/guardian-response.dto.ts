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
