import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { CreateFranchiseDto } from './create-franchise.dto';

const NULLABLE_ON_UPDATE = ['mobileNumber', 'address', 'type', 'defaultLanguage', 'defaultCurrency', 'description', 'logoUrl', 'bannerUrl'] as const;

/**
 * FOUND PROACTIVELY (Phase 23, mirroring the identical fix already applied to
 * UpdateSchoolDto/UpdateBranchDto — see UpdateSchoolDto's own header comment
 * for the full reasoning): FranchisesService.update() already forwards every
 * one of these fields straight through as `data.<field>` with no ternary
 * (franchises.service.ts), and they're all nullable `String?` columns on the
 * Franchise model (schema.prisma), so an explicit `null` already clears the
 * column and `undefined` already leaves it unchanged at the Prisma layer.
 * This DTO's type just hadn't caught up — a bare `PartialType(CreateFranchiseDto)`
 * before this fix, same shape the bug had in every other Update DTO this
 * pattern was found in.
 *
 * No live frontend consumer existed for this yet (Franchise had no
 * school-portal UI at all before this phase), so unlike the School/Branch
 * instance of this bug, this one was caught before it ever shipped broken —
 * closed here as part of building that UI for the first time, not as a
 * separate fix.
 *
 * Deliberately NOT widened: `name` (required), `activities`/`facilities`
 * (arrays — same reasoning as CreateFranchiseDto's own array fields, a client
 * sends a real, possibly-empty array, never undefined-as-clear), `feeModel`
 * (enum, no "clear" concept), and `flatFeeAmount`/`perHeadcountRate`
 * (deliberately out of scope — clearing a configured fee rate back to
 * "unconfigured" interacts with FranchisesService.update()'s own
 * schoolsAlreadyBilling/Stripe-Price-immutability guard, which has no
 * confirmed design for that case).
 *
 * CORRECTED ON REVIEW: a first draft of this comment claimed "there is
 * nothing forcing that decision here" because the school-portal form never
 * sends an explicit `null` for these two fields — but `@IsOptional()` treats
 * an explicit `null` exactly like an omitted field and skips
 * `@IsInt()`/`@Min()`/`@Max()` entirely, so nothing at THIS layer actually
 * stopped a raw HTTP client from sending `null` and silently clearing a
 * configured rate. FranchisesService.update() now explicitly rejects an
 * explicit `null` on either field with a BadRequestException — see that
 * method's own comment — closing the gap this DTO's typing alone could not.
 */
export class UpdateFranchiseDto extends PartialType(OmitType(CreateFranchiseDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mobileNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

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

  @ApiPropertyOptional({ description: 'One of the 6 confirmed currencies — same free-text caveat as defaultLanguage.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultCurrency?: string | null;

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
}
