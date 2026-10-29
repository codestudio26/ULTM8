import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsPhoneNumber, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Trimmed; an empty string clears the field (null). */
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'INSTRUCTOR', 'BRANCH_STAFF'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** GET /schools/{schoolId}/staff filters (Decision 361). */
export class StaffListQueryDto {
  @ApiPropertyOptional({
    enum: ['active', 'paused', 'removed', 'all'],
    description: 'Default active, which includes paused staff (Decision 390). "paused" = paused only. "removed" = had a staff role here, holds none now and is not paused.',
  })
  @IsOptional()
  @IsIn(['active', 'paused', 'removed', 'all'])
  status?: 'active' | 'paused' | 'removed' | 'all';

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Part of a name or email, any capitals.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class StaffRoleDto {
  @ApiProperty({ description: 'The RoleGrant id — what DELETE /users/{userId}/role-grants/{id} takes.' })
  grantId!: string;

  @ApiProperty({ enum: STAFF_ROLES })
  role!: StaffRole;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty()
  grantedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  grantedByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  revokedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 390: set while this role is paused (revokedAt is set too). Unpausing gives it back.' })
  pausedAt!: string | null;
}

/** Decision 387 — a Branch Staff member's access switches. */
export class StaffAccessDto {
  @ApiProperty({ description: 'Manage classes and the timetable at their branches (off by default).' })
  @IsBoolean()
  classes!: boolean;

  @ApiProperty({ description: 'Manage bookings and check-in at their branches (on by default).' })
  @IsBoolean()
  bookings!: boolean;

  @ApiProperty({ description: 'See and edit the students of their branches (on by default).' })
  @IsBoolean()
  students!: boolean;

  @ApiProperty({ description: 'Cancel classes at their branches and give credit back, never refunds (on by default).' })
  @IsBoolean()
  cancelClasses!: boolean;

  @ApiProperty({ description: "See the staff list for their branches, read only (off by default)." })
  @IsBoolean()
  staffList!: boolean;

  @ApiProperty({ description: 'Invite coaches (off by default; Decision 183).' })
  @IsBoolean()
  inviteCoaches!: boolean;

  @ApiProperty({ description: 'Manage disciplines, belts and skills for the whole School (off by default; Decision 383).' })
  @IsBoolean()
  disciplines!: boolean;

  @ApiProperty({ description: "Change the School's check-in rules (off by default; Decision 394)." })
  @IsBoolean()
  checkInRules!: boolean;

  @ApiProperty({ description: 'Export the student list as a spreadsheet (off by default; Decision 399).' })
  @IsBoolean()
  exportStudents!: boolean;
}

export class StaffAccessResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: StaffAccessDto })
  access!: StaffAccessDto;
}

/** GET /schools/{schoolId}/staff/me/access — what the caller may do here. */
export class MyStaffAccessResponseDto {
  @ApiProperty({ description: 'School Owner/Manager: every switch is on, by role.' })
  owner!: boolean;

  @ApiProperty({ description: 'Holds an active Branch Staff role here.' })
  branchStaff!: boolean;

  @ApiProperty({ type: StaffAccessDto, description: "What the caller may do. An Instructor's own role gives bookings and students." })
  access!: StaffAccessDto;
}

export class StaffMemberDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  profilePhotoUrl!: string | null;

  @ApiProperty({ description: 'Holds at least one active staff, coach or owner role here.' })
  active!: boolean;

  @ApiProperty({ description: 'When they were first given a staff role here.' })
  addedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'When their last staff role here ended, for removed staff.' })
  removedAt!: string | null;

  @ApiProperty({ description: 'Decision 390: an owner paused their coach and Branch Staff roles here; Unpause gives them back. Never true with active.' })
  paused!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 390: when they were paused.' })
  pausedAt!: string | null;

  @ApiProperty()
  canInviteCoaches!: boolean;

  @ApiProperty({ description: 'Branch Staff the owner lets edit styles, belts and skills (Decision 383).' })
  canManageDisciplines!: boolean;

  @ApiProperty({ description: "The School's main owner (Decision 370). Other owners are co-owners." })
  mainOwner!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 381: the School's own name for them, set by an owner. Null = not set." })
  displayName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 381: their work phone at this School (E.164), set by an owner. Null = not set.' })
  workPhone!: string | null;

  @ApiPropertyOptional({
    type: StaffAccessDto,
    nullable: true,
    description: "Decision 387: their access switches, for active or paused Branch Staff in the owner's view; null otherwise.",
  })
  access!: StaffAccessDto | null;

  @ApiProperty({ type: [StaffRoleDto], description: 'Active roles first, then ended ones, newest first.' })
  roles!: StaffRoleDto[];
}

export class StaffListResponseDto {
  @ApiProperty({ type: [StaffMemberDto] })
  items!: StaffMemberDto[];
}

export const REMOVE_CLASSES_CHOICES = ['REASSIGN', 'NONE', 'CANCEL'] as const;
export type RemoveClassesChoice = (typeof REMOVE_CLASSES_CHOICES)[number];

/** POST /schools/{schoolId}/staff/{userId}/remove body: what happens to the
 * classes the person still teaches here. Needed only when they teach some. */
export class RemoveFromSchoolDto {
  @ApiPropertyOptional({
    enum: REMOVE_CLASSES_CHOICES,
    description:
      'REASSIGN: their upcoming classes and weekly slots go to toUserId. NONE: they run with no instructor. ' +
      'CANCEL: their upcoming classes are cancelled as the School would cancel them; their weekly slots are kept with no instructor.',
  })
  @IsOptional()
  @IsIn(REMOVE_CLASSES_CHOICES)
  classes?: RemoveClassesChoice;

  @ApiPropertyOptional({ description: 'With REASSIGN only: the coach at this School who takes them over (a User id).' })
  @IsOptional()
  @IsUUID()
  toUserId?: string;
}

export class RemoveFromSchoolResponseDto {
  @ApiProperty({ description: 'How many roles were ended.' })
  removedRoles!: number;

  @ApiProperty({ description: 'Upcoming classes given to the other coach.' })
  classesReassigned!: number;

  @ApiProperty({ description: 'Upcoming classes left with no instructor.' })
  classesCleared!: number;

  @ApiProperty({ description: 'Upcoming classes cancelled.' })
  classesCancelled!: number;

  @ApiProperty({ description: 'Weekly timetable slots given to the other coach.' })
  slotsReassigned!: number;

  @ApiProperty({ description: 'Weekly timetable slots left with no instructor.' })
  slotsCleared!: number;
}

/** GET /schools/{schoolId}/staff/{userId}/teaching: what "Remove from School"
 * would ask about. */
export class StaffTeachingResponseDto {
  @ApiProperty({ description: 'Upcoming classes they teach here (not ended, cancelled or archived).' })
  upcomingClasses!: number;

  @ApiProperty({ description: 'Active weekly timetable slots they teach here (on, not archived).' })
  activeSlots!: number;
}

/** POST /schools/{schoolId}/main-owner (Decision 370). */
export class HandOverMainOwnerDto {
  @ApiProperty({ description: 'A co-owner of this School, who becomes its main owner.' })
  @IsUUID()
  userId!: string;
}

export class MainOwnerResponseDto {
  @ApiProperty()
  mainOwnerUserId!: string;
}

/** PATCH /schools/{schoolId}/staff/{userId}/details (Decision 381). A field
 * left out is unchanged; null or an empty string clears it. */
export class UpdateStaffDetailsDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(80)
  displayName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'E.164, e.g. +447700900123.' })
  @IsOptional()
  @Transform(trimToNull)
  @IsPhoneNumber(undefined, { message: 'workPhone must be a valid E.164 number' })
  workPhone?: string | null;
}

export class StaffDetailsResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  displayName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  workPhone!: string | null;
}

/** POST /schools/{schoolId}/staff/{userId}/pause (Decision 390). */
export class PauseStaffResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ description: 'How many coach and Branch Staff roles were paused.' })
  pausedRoles!: number;

  @ApiProperty()
  pausedAt!: string;
}

/** POST /schools/{schoolId}/staff/{userId}/unpause (Decision 390). */
export class UnpauseStaffResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ description: 'How many roles came back.' })
  restoredRoles!: number;

  @ApiProperty({
    type: [String],
    description: 'Branches closed while they were paused: their roles there did not come back. Give them a role at another branch if they need one.',
  })
  closedBranches!: string[];
}
