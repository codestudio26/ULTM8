import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the WaiverSignature Prisma model. */
export class WaiverSignatureResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  waiverId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  signerFullName!: string;

  @ApiProperty()
  signatureText!: string;

  @ApiProperty()
  signedDate!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class WaiverSignatureListResponseDto {
  @ApiProperty({ type: [WaiverSignatureResponseDto] })
  items!: WaiverSignatureResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
