import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape — see school-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`, without which
 * openapi-typescript silently generates `Record<string, never>` for it). Field-for-field
 * match of the Class Prisma model.
 */
export class ClassResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  instructorId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Nullable = unlimited.' })
  capacity!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bookingEndAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  qrAttendanceEndAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  refundFeeDate!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Minor currency unit (e.g. cents)." })
  cancellationCharge!: number | null;

  @ApiProperty()
  termsWaiverRequired!: boolean;

  @ApiProperty()
  membershipInclusion!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class ClassListResponseDto {
  @ApiProperty({ type: [ClassResponseDto] })
  items!: ClassResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
