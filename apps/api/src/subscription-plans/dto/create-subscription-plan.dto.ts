import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Postgres INTEGER's own ceiling (2^31-1) — same bound
 * CreateFranchiseDto.flatFeeAmount/perHeadcountRate already use for every other
 * unbounded minor-unit money field in this schema (Decision 84's convention). */
const POSTGRES_INTEGER_MAX = 2147483647;

/** POST /platform-admin/subscription-plans body. Field-for-field the confirmed
 * SubscriptionPlan shape (Spec 55 §6.1, quoted): "Plan name, price... description,
 * feature list" — "payment type (Auto Renew)"/"payment schedule" are deliberately
 * NOT fields here; see the Prisma model's own schema.prisma comment for why they
 * carry no information beyond what a SubscriptionPlan row already structurally is. */
export class CreateSubscriptionPlanDto {
  @ApiProperty({ description: 'Plan name, e.g. "Growth".' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ description: 'Minor-unit (e.g. cents), single USD anchor currency (Decision 7) — e.g. "£30.00 Per Month" in Spec 55\'s own example is 3000.' })
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  price!: number;

  @ApiPropertyOptional({ type: [String], description: 'Marketing feature-list bullets shown alongside the plan.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  featureList?: string[];
}
