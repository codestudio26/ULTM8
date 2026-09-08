import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the MembershipPlan Prisma model — see class-response.dto.ts's
 * header comment for the nullable-field `type`+`nullable: true` convention this follows. */
export class MembershipPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  price!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  expiryDurationDays!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  classesIncluded!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  scopedClassId!: string | null;

  @ApiProperty()
  visible!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  refundFeeDate!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  cancellationCharge!: number | null;

  @ApiProperty()
  termsWaiverRequired!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class MembershipPlanListResponseDto {
  @ApiProperty({ type: [MembershipPlanResponseDto] })
  items!: MembershipPlanResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
