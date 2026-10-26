import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { ClassCancellationPolicyDto } from './create-school.dto';
import { PostalAddressColumnsResponseDto } from '../../../common/address/postal-address.dto';

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
export class SchoolResponseDto extends PostalAddressColumnsResponseDto {
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

  /** Decision 346 — the School Owner's half of the both-must-allow switch for
   * showing the Franchise's name and logo. Reset on joining or leaving. */
  @ApiProperty()
  showFranchiseBranding!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultLanguage!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  defaultCurrency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'IANA timezone name.' })
  timezone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bannerUrl!: string | null;

  /** Decision 266 — server-generated at creation, regenerable by the Owner
   * (`POST /schools/:id/join-code/regenerate`). Never client-settable — see
   * CreateSchoolDto/UpdateSchoolDto's own comments on why it's absent there. */
  @ApiProperty({ description: "8-character code for apps/student's pre-auth School-pick screen." })
  joinCode!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: '6-digit hex color, e.g. #1A73E8.' })
  accentColor!: string | null;

  // Decision 257 — per-School footer content; see CreateSchoolDto's own
  // comment on these fields.
  @ApiPropertyOptional({ type: String, nullable: true })
  footerAboutUs!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerContactEmail!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerContactPhone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerFacebookUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerInstagramUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerTiktokUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerYoutubeUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  footerTwitterUrl!: string | null;

  @ApiProperty({ enum: ClassCancellationPolicyDto })
  classCancellationPolicy!: ClassCancellationPolicyDto;

  @ApiProperty()
  waitlistClaimWindowMinutes!: number;

  @ApiProperty({ description: 'Minutes before a Class starts that check-in opens.' })
  checkInOpensMinutesBeforeStart!: number;

  @ApiProperty({ enum: ['NO_REFUND_ONCE_STARTED', 'REFUND_UNTIL_END', 'ALWAYS_REFUND'] })
  lateCancelRefundPolicy!: 'NO_REFUND_ONCE_STARTED' | 'REFUND_UNTIL_END' | 'ALWAYS_REFUND';

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

/**
 * FOUND ON REVIEW — Decision 266's SchoolThemeProvider (apps/student) only
 * ever needs `accentColor`/`logoUrl`; its first draft called the full
 * `GET /schools/:id` (SchoolResponseDto above) to get them, which — since
 * this codebase has no ClassSerializerInterceptor anywhere (confirmed:
 * every response DTO here is a manually-matched shape, not an enforced
 * serialization boundary) — handed every operational/internal School field
 * (mobileNumber, businessType, classCancellationPolicy, joinCode, etc.) to
 * every enrolled Student on every app launch, not just the small set of
 * fields the theme actually needs. `GET /schools/:id/theme`
 * (SchoolsService.findTheme) exists purely to narrow that.
 */
export class SchoolThemeResponseDto extends PickType(SchoolResponseDto, ['id', 'accentColor', 'logoUrl'] as const) {}

/** Decision 346 — the Franchise's name and logo for a member School, given only
 * when both the Franchise Owner (shareBrandingWithMembers) and the School Owner
 * (showFranchiseBranding) allow it, and the Franchise isn't closed. */
export class SchoolFranchiseBrandingResponseDto {
  @ApiProperty({ description: 'The School belongs to a Franchise whose Owner allows member Schools to show its name and logo.' })
  franchiseAllows!: boolean;

  @ApiProperty({ description: "The School Owner's own switch (School.showFranchiseBranding)." })
  schoolShows!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Set only when both allow it.' })
  name!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Set only when both allow it.' })
  logoUrl!: string | null;
}

export class SchoolListResponseDto {
  @ApiProperty({ type: [SchoolResponseDto] })
  items!: SchoolResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
