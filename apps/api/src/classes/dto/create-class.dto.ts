import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * Field list verified directly against domain-rules §9's confirmed Class row (not
 * reverse-inferred) — see the Phase 4 kickoff prompt for the full citation trail.
 *
 * schoolId is a route param (`/schools/:schoolId/classes`), not a body field — same
 * convention as CreateBranchDto.
 *
 * Deliberately excluded (out of scope this phase — see the Phase 4 kickoff prompt):
 *  - Any Booking/waitlist field or relation.
 *  - Anything materialized-from-TimetableSlot related (TimetableModule is Phase 5).
 *
 * Inferred, not directly confirmed by §9 — each flagged for Architect review rather than
 * presented as settled:
 *  - branchId's nullability (mirrors RoleGrant.branchId's established "School-wide by
 *    default, narrowable to one Branch" shape).
 *  - activities' cardinality (required, at least one) — §9 doesn't state this either way.
 *  - cancellationCharge modeled as a minor-unit integer (cents), not Decimal/float — no
 *    existing precedent in this codebase for a money field; minor-unit integers are
 *    consistent with domain-rules §7's existing "rounded once to the currency's minor
 *    unit" rule and avoid float-rounding entirely.
 *
 * instructorId is validated in ClassesService (not here) against RoleGrant directly —
 * "an Instructor" per §9 means a User holding an active INSTRUCTOR RoleGrant at this
 * Class's School, not a separate Instructor table (domain-rules §6.1).
 *
 * Length/format limits follow the same convention CreateSchoolDto/CreateBranchDto
 * already established: short free text capped at 100, longer free text (description) at
 * 500, URLs at 2048 chars validated as actual URLs, activities capped at 20 elements
 * (matching School.activities' own cap).
 */
export class CreateClassDto {
  @ApiPropertyOptional({ description: 'Branch to scope this Class to. Omit for a School-wide Class.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'A User holding an active INSTRUCTOR RoleGrant at this School.' })
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  title!: string;

  @ApiProperty({ type: [String], description: 'At least one activity/discipline this Class covers.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  activities!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'ISO 8601 date-time.' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'ISO 8601 date-time.' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Nullable/omitted = unlimited.', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time — booking cutoff.' })
  @IsOptional()
  @IsDateString()
  bookingEndAt?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time — end of the QR check-in window.' })
  @IsOptional()
  @IsDateString()
  qrAttendanceEndAt?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 date-time — cancel-before-this cutoff for refund/credit.' })
  @IsOptional()
  @IsDateString()
  refundFeeDate?: string;

  @ApiPropertyOptional({ description: "Minor currency unit (e.g. cents), in the School/Branch's own currency." })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCharge?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  termsWaiverRequired?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Opts this Class into general-membership access. Default is opt-out (a ticket is required).' })
  @IsOptional()
  @IsBoolean()
  membershipInclusion?: boolean;
}
