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

export class RemoveFromSchoolResponseDto {
  @ApiProperty({ description: 'How many roles were ended.' })
  removedRoles!: number;
}
