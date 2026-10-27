import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';
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
}
