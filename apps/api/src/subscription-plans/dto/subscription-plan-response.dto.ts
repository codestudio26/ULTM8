import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response DTO — field-for-field match of the SubscriptionPlan Prisma model. No
 * field excluded — every column is meant to be readable by any authenticated tenant
 * caller browsing plans to subscribe to, same "nothing here is sensitive" reasoning
 * TranslationResponseDto's own header comment already gives for its identical
 * no-exclusion shape. */
export class SubscriptionPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Minor-unit, single USD anchor currency.' })
  price!: number;

  @ApiProperty({ type: [String] })
  featureList!: string[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class SubscriptionPlanListResponseDto {
  @ApiProperty({ type: [SubscriptionPlanResponseDto] })
  items!: SubscriptionPlanResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
