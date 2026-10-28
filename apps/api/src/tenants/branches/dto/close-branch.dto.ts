import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** A move target that means "no Branch: the whole School". */
export const WHOLE_SCHOOL = 'WHOLE_SCHOOL';

/**
 * POST /branches/:id/close (Decision 330, fix 6). One target per group of
 * things still in use at the Branch. A target is another open Branch of the
 * same School, or `WHOLE_SCHOOL` where that group may have no Branch. A group
 * that has nothing in it needs no target.
 */
export class CloseBranchDto {
  @ApiPropertyOptional({ description: `Where upcoming Classes and weekly timetable slots go: a Branch id, or "${WHOLE_SCHOOL}".` })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  classesTo?: string;

  @ApiPropertyOptional({ description: `New home Branch for Students: a Branch id, or "${WHOLE_SCHOOL}" for no home Branch.` })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  studentsTo?: string;

  @ApiPropertyOptional({ description: `Where Instructor profiles go: a Branch id, or "${WHOLE_SCHOOL}".` })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  instructorsTo?: string;

  @ApiPropertyOptional({
    description:
      'Where active Branch Staff and coach roles go: a Branch id only. A Branch role never becomes School-wide; remove access on the Staff page instead.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  staffTo?: string;
}

/** GET /branches/:id/close-preview — what closing would move, and whether
 * the Branch keeps its history afterwards. */
export class BranchClosePreviewDto {
  @ApiProperty({ description: 'Classes that have not ended yet, not counting archived ones.' })
  upcomingClasses!: number;

  @ApiProperty({ description: 'Weekly timetable slots, not counting archived ones.' })
  timetableSlots!: number;

  @ApiProperty({ description: 'Instructor profiles, not counting archived ones.' })
  instructors!: number;

  @ApiProperty({ description: 'Students with this as their home Branch.' })
  students!: number;

  @ApiProperty({ description: 'Active Branch Staff and coach roles scoped to this Branch.' })
  staffRoles!: number;

  @ApiProperty({ description: 'Coach invites to this Branch not yet accepted, cancelled or expired. Closing cancels them.' })
  pendingCoachInvites!: number;

  @ApiProperty({ description: 'Whether the Branch has a past (classes, slots, Instructor profiles or roles). If so it is kept after closing, never removed.' })
  hasHistory!: boolean;
}
