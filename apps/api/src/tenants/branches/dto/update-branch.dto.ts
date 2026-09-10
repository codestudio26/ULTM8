import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { CreateBranchDto } from './create-branch.dto';

const NULLABLE_ON_UPDATE = ['address', 'contactPhone', 'timezone', 'currencyOverride', 'logoUrl', 'bannerUrl'] as const;

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
 * Deliberately NOT widened: `name` (required — nothing to "clear").
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
  @MaxLength(2048)
  @IsUrl()
  logoUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string | null;
}
