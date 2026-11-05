import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ClassCancellationPolicyDto, ClassCancellationPolicyWindowDto, SchoolCancelledClassResolutionDto } from '../../schools/dto/create-school.dto';
import { CreateBranchDto } from './create-branch.dto';

const NULLABLE_ON_UPDATE = [
  'address',
  'contactPhone',
  'timezone',
  'currencyOverride',
  'type',
  'defaultLanguage',
  'description',
  'logoUrl',
  'bannerUrl',
] as const;

/**
 * FOUND PROACTIVELY (Phase 18, prompted by the altitude review's own check for
 * this exact gap elsewhere in the codebase after fixing it for Class/
 * Instructor/TimetableSlot/MembershipPlan): BranchesService.update()'s Prisma
 * call already forwards every one of these fields straight through as
 * `data.<field>` with no ternary, and they're all nullable `String?` columns
 * on the Branch model — so an explicit `null` already clears the column and
 * `undefined` already leaves it unchanged. This DTO's type just hadn't caught
 * up, the same gap Phase 17 found and fixed for other modules.
 *
 * This one is not hypothetical: `apps/school-portal/src/branches/
 * BranchFormModal.tsx` is Phase 3's own, already-shipped Edit Branch form, and
 * it already tries to clear these fields via `value || undefined` on submit —
 * meaning this exact bug has been live (silently no-op'ing a cleared field on
 * Branch edit) since Phase 3, not just a risk in some not-yet-built screen.
 * Fixed here alongside the frontend form itself, not left for a future
 * "someone eventually clicks Edit Branch and notices" discovery.
 *
 * Deliberately NOT widened: `name` (required — nothing to "clear"); `activities`/
 * `facilities` (arrays — same reasoning as UpdateFranchiseDto's own array
 * fields, a client sends a real, possibly-empty array, never undefined-as-clear).
 *
 * Decision 231's four new fields (`type`/`activities`/`facilities`/
 * `defaultLanguage`/`description`) follow the exact same nullable-vs-array
 * split UpdateFranchiseDto already established for its own identical fields.
 */
export class UpdateBranchDto extends PartialType(OmitType(CreateBranchDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactPhone?: string | null;

  @ApiPropertyOptional({ description: 'IANA timezone name.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  currencyOverride?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string | null;

  @ApiPropertyOptional({ description: 'One of the 4 confirmed languages — free text, matching School.defaultLanguage\'s existing treatment (no canonical code list confirmed anywhere yet, domain-rules §1).', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultLanguage?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  logoUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string | null;

  // Decision 292 — this Branch's own "Class cancellations" settings. Same
  // meanings and limits as School's (UpdateSchoolDto); they only apply while
  // cancellationSettingsOverride is true.
  @ApiPropertyOptional({ description: 'true = this Branch uses the six settings below instead of its School\'s. Defaults to false (same as the School).' })
  @IsOptional()
  @IsBoolean()
  cancellationSettingsOverride?: boolean;

  @ApiPropertyOptional({ enum: ClassCancellationPolicyDto })
  @IsOptional()
  @IsEnum(ClassCancellationPolicyDto)
  classCancellationPolicy?: ClassCancellationPolicyDto;

  @ApiPropertyOptional({ enum: ClassCancellationPolicyWindowDto })
  @IsOptional()
  @IsEnum(ClassCancellationPolicyWindowDto)
  classCancellationPolicyWindow?: ClassCancellationPolicyWindowDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  chargeLateCancellationFee?: boolean;

  @ApiPropertyOptional({ enum: SchoolCancelledClassResolutionDto })
  @IsOptional()
  @IsEnum(SchoolCancelledClassResolutionDto)
  schoolCancelledClassResolution?: SchoolCancelledClassResolutionDto;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Hours before start. null = no cutoff.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultRefundCutoffHours?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Minor-unit amount. null = off.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  noShowFee?: number | null;

  // Decision 430 (MON-6): this Branch's own tax lines, used for the members
  // whose home Branch this is, instead of the School's. Off by default.
  @ApiPropertyOptional({ description: "Decision 430 (MON-6): use this Branch's own tax lines instead of the School's (e.g. GST + QST in Québec)." })
  @IsOptional()
  @IsBoolean()
  taxOverride?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40, description: "The first tax line's name, e.g. GST." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  taxName?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, description: "The first tax line's rate, in hundredths of a percent." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  taxRateBasisPoints?: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: "The first tax line's registration number." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(50)
  taxId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40, description: "The second tax line's name, e.g. QST (required when its rate is above 0)." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  tax2Name?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, description: "The second tax line's rate (0 = no second line). Both lines together at most 100%." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  tax2RateBasisPoints?: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: "The second tax line's registration number." })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(50)
  tax2Id?: string | null;
}
