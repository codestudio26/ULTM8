import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * Field list verified directly against Spec 55's confirmed Instructor entity row
 * (quoted, not paraphrased): "Name, photo, belt/ranking, specializations
 * (activities), phone, years of experience, bio; linked User account for its own
 * login." See the Phase 6 kickoff prompt for the full citation trail.
 *
 * `userId` is the User this profile belongs to — required in the body (not derivable
 * from the route) since creating a profile is a distinct step from holding the
 * RoleGrant itself: InstructorsService validates `userId` already holds an active
 * INSTRUCTOR RoleGrant at this School (matching `branchId`, if set) before allowing
 * the profile to be created — see InstructorsService.create().
 *
 * `schoolId` is a route param (`/schools/:schoolId/instructors`), not a body field —
 * same convention as CreateClassDto/CreateBranchDto.
 *
 * "Name" isn't modeled as a separate field here — the confirmed field list's own
 * parenthetical ties it to "linked User account", i.e. User.firstName/surname, not a
 * duplicate copy on this profile row.
 *
 * `specializations` is optional (no minimum-size requirement), unlike
 * CreateClassDto.activities' inferred "at least one" — nothing in the confirmed field
 * list states a cardinality requirement for an Instructor's own specializations, and
 * unlike a Class (which must cover some activity to exist at all), an Instructor
 * profile can meaningfully exist before that's filled in. Flagged for Architect review
 * as an inferred choice, same treatment as CreateClassDto's own cardinality note.
 *
 * `phone` is validated the same way every other phone field in this codebase is
 * (`@IsPhoneNumber`, E.164) — see auth/dto/register.dto.ts — but is a distinct,
 * optional School-facing contact number, not assumed identical to the profiled User's
 * own login phone.
 *
 * Length/format limits follow the same convention CreateSchoolDto/CreateClassDto
 * already established: short free text capped at 100, longer free text (bio) at 500,
 * URLs at 2048 chars validated as actual URLs, array fields capped at 20 elements
 * (matching School.activities'/CreateClassDto.activities' own cap).
 */
export class CreateInstructorDto {
  @ApiProperty({ description: 'The User this profile belongs to. Must already hold an active INSTRUCTOR RoleGrant at this School (matching branchId, if set).' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ description: 'Branch to scope this profile to. Omit for a School-wide profile.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  photoUrl?: string;

  @ApiPropertyOptional({ description: 'Plain display text (e.g. "Black Belt, 3rd Dan") — not a live reference into the grading system.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  beltRanking?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  specializations?: string[];

  @ApiPropertyOptional({ description: 'School-facing contact number, E.164 — distinct from this User\'s own login phone.' })
  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  yearsOfExperience?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}
