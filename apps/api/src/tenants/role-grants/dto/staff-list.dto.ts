import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'INSTRUCTOR', 'BRANCH_STAFF'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** GET /schools/{schoolId}/staff filters (Decision 361). */
export class StaffListQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'removed', 'all'], description: 'Default active. "removed" = had a staff role here, holds none now.' })
  @IsOptional()
  @IsIn(['active', 'removed', 'all'])
  status?: 'active' | 'removed' | 'all';

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

  @ApiProperty()
  canInviteCoaches!: boolean;

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
