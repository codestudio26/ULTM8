import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClassCancellationPolicyDto } from './create-school.dto';

/**
 * Response shape — added in Phase 3 for packages/api-client generation (see
 * apps/api/src/auth/dto/auth-response.dto.ts's header comment for why this exists).
 * Field-for-field match of the School Prisma model (schema.prisma) — never
 * hand-invented, re-verified against the schema before writing this.
 *
 * Every nullable field below passes an explicit `type` alongside `nullable: true` —
 * without it, Nest's Swagger decorator can't always infer the property's type from a
 * bare `field!: string | null` class-field declaration and silently emits an empty-
 * object schema instead, which openapi-typescript then generates as
 * `Record<string, never>` — a real bug caught by the generated client failing to
 * typecheck against these DTOs' actual shapes, not a style preference.
 */
export class SchoolResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  franchiseId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  mobileNumber!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  businessType!: string | null;

  @ApiProperty({ type: [String] })
  activities!: string[];

  @ApiProperty({ type: [String] })
  facilities!: string[];

  @ApiProperty()
  ranksToggle!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultLanguage!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultCurrency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  @ApiProperty({ enum: ClassCancellationPolicyDto })
  classCancellationPolicy!: ClassCancellationPolicyDto;

  @ApiProperty()
  waitlistClaimWindowMinutes!: number;

  @ApiPropertyOptional({ type: String, nullable: true, enum: ['ACTIVE', 'PAST_DUE', 'CANCELED'] })
  franchiseFeeSubscriptionStatus!: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  /** Phase 56/57 (Decision 110) — already returned at runtime before this field
   * existed on this DTO (no explicit `select` anywhere this DTO is built from,
   * and ultm8_app holds whole-table SELECT on School) — this just makes the
   * type match reality, for `apps/platform-admin`'s own close/reactivate UI
   * (Phase 57) to read without a cast. */
  @ApiPropertyOptional({ type: String, nullable: true })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  purgeAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  purgedAt!: string | null;

  /**
   * Present only on the response from POST /schools (self-service creation) — a
   * freshly-minted token reflecting the caller's new SCHOOL_OWNER_MANAGER grant
   * (ultm8-nestjs-module §7's narrow, approved exception to "JWTs only rebuild at
   * login"). Absent everywhere else (GET/PATCH never re-mint anything). Optional, not
   * required, specifically so this is a backward-compatible addition to the response
   * shape rather than a breaking one — a client that doesn't know about this field
   * still gets a valid School back.
   */
  @ApiPropertyOptional({ type: String })
  accessToken?: string;
}

export class SchoolListResponseDto {
  @ApiProperty({ type: [SchoolResponseDto] })
  items!: SchoolResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
