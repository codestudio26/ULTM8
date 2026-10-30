import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { ClassCancellationPolicyDto, ClassCancellationPolicyWindowDto, SchoolCancelledClassResolutionDto } from './create-school.dto';
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

  /** Decision 350 — the School Owner's half of the both-must-allow switch for
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

  @ApiProperty({ enum: ClassCancellationPolicyWindowDto })
  classCancellationPolicyWindow!: ClassCancellationPolicyWindowDto;

  @ApiProperty()
  chargeLateCancellationFee!: boolean;

  @ApiProperty({ enum: SchoolCancelledClassResolutionDto })
  schoolCancelledClassResolution!: SchoolCancelledClassResolutionDto;

  @ApiPropertyOptional({ type: Number, nullable: true })
  defaultRefundCutoffHours!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  noShowFee!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 292 — when the owner last saved the cancellation policy. Null until they choose one; the portal asks them to.' })
  cancellationPolicyChosenAt!: string | null;

  @ApiProperty({ description: 'Minutes before a Class starts that check-in opens.' })
  checkInOpensMinutesBeforeStart!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Decision 394: minutes after a Class starts that check-in closes (0 = at the start). Null: when the Class ends.' })
  checkInClosesMinutesAfterStart!: number | null;

  @ApiProperty({ description: 'Decision 394: a signed waiver is needed to check in, whatever the Class says.' })
  checkInRequireWaiver!: boolean;

  @ApiProperty({ description: "Decision 394: members with a home Branch may check in at the School's other Branches." })
  checkInOtherBranches!: boolean;

  @ApiProperty({ description: 'Decision 394: Visitors may check in on their visit pass.' })
  checkInVisitors!: boolean;

  @ApiProperty({ description: 'Decision 394: the front desk may check someone in to several Classes at once.' })
  checkInSeveralClasses!: boolean;

  @ApiProperty({ description: 'Decision 404: members whose membership is frozen may still check in (default off).' })
  checkInFrozenMembers!: boolean;

  @ApiProperty({ description: 'Decision 404: the most days a membership can be frozen in any 12 months (default 90).' })
  freezeMaxDaysPer12Months!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Decision 404: the freeze fee in minor units of the School's currency; null = no fee." })
  freezeFeeAmount!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 411: the country the School is in, for its tax.' })
  taxCountry!: string | null;

  @ApiProperty({ description: "Decision 411: the School's tax rate on charges, in hundredths of a percent (default 0)." })
  taxRateBasisPoints!: number;

  @ApiProperty({ description: "Decision 411: the School's prices include tax (true, the default) or have it added on top." })
  taxInclusive!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 338 item 6: the School's tax ID for its invoices." })
  taxId!: string | null;

  @ApiProperty({ description: 'Decision 338 item 1: a reason is required when cancelling a charge (default on).' })
  chargeCancelReasonRequired!: boolean;

  @ApiProperty({ description: 'Decision 338 item 3: notes are required when refunding (default on).' })
  chargeRefundNotesRequired!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 338 item 6: the School's address on its invoices and receipts." })
  receiptAddress!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 338 item 6: payment instructions on its invoices.' })
  receiptPaymentInstructions!: string | null;

  @ApiProperty({ description: 'Decision 338 item 10: payment receipts to the member (default on).' })
  chargeNoticeReceipt!: boolean;

  @ApiProperty({ description: 'Decision 338 item 10: failed or overdue payment notices to the member (default on).' })
  chargeNoticeFailedOverdue!: boolean;

  @ApiProperty({ description: 'Decision 338 item 10: dispute notices to the member (default on).' })
  chargeNoticeDispute!: boolean;

  @ApiProperty({ description: 'Decision 338 item 10: "Payment due soon", 3 days before a charge is due (default on).' })
  chargeNoticeDueReminder!: boolean;

  @ApiProperty({ description: 'Decision 414 item 4: "Refund" notices to the member (default on).' })
  chargeNoticeRefund!: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Decision 391: days a Visitor\'s visit pass lasts. Null until the School sets it.' })
  visitorPeriodDays!: number | null;

  @ApiPropertyOptional({ type: [String], nullable: true, description: 'Decision 392: the "How did you hear about us?" choices. Null: the starting list, shown in the viewer\'s language.' })
  heardFromOptions!: string[] | null;

  @ApiProperty({ enum: [4, 6], description: 'Length of the check-in codes ULTM8 generates here (staff kiosk codes, members\' personal codes).' })
  checkInCodeDigits!: number;

  @ApiProperty({ enum: ['NO_REFUND_ONCE_STARTED', 'REFUND_UNTIL_END', 'ALWAYS_REFUND'] })
  lateCancelRefundPolicy!: 'NO_REFUND_ONCE_STARTED' | 'REFUND_UNTIL_END' | 'ALWAYS_REFUND';

  @ApiProperty({ description: 'Branch Staff may record desk payments (Decision 347).' })
  branchStaffCanRecordPayments!: boolean;

  @ApiProperty({ enum: ['MONDAY', 'SUNDAY'], description: 'First day of the Timetable\'s week (Decision 319 §4).' })
  weekStartsOn!: 'MONDAY' | 'SUNDAY';

  @ApiProperty({ enum: ['LIST', 'GRID'], description: 'The layout the Timetable opens in (Decision 319 §4).' })
  timetableDefaultLayout!: 'LIST' | 'GRID';

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

  /** Backlog 3.14: a free trial of ULTM8. After `platformTrialEndsAt`, without
   * an active platform subscription, the portal is read-only. A School's own
   * read sends both as null once it subscribes. */
  @ApiPropertyOptional({ type: String, nullable: true })
  platformTrialStartedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  platformTrialEndsAt!: string | null;

  /** Platform Admin's School read only; a School's own read leaves it out. */
  @ApiPropertyOptional({ type: String, nullable: true, enum: ['ACTIVE', 'PAST_DUE', 'CANCELED'] })
  platformSubscriptionStatus?: string | null;

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

/** Decision 350 — the Franchise's name and logo for a member School, given only
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
