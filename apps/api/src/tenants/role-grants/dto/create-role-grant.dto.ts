import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * The role-grant relationships this endpoint is authorized to create: School Owner/
 * Manager inviting an Instructor or Branch Staff member within their own School
 * (Spec §8.2: School Owner/Manager's scope explicitly includes "Instructor and Branch
 * Staff invitations"), plus — as of Decision 269 — a School Owner/Manager granting
 * another SCHOOL_OWNER_MANAGER at their own School (co-ownership/succession). This is
 * still deliberately NOT the full RoleGrant.role enum: granting FRANCHISE_OWNER at a
 * School it doesn't directly operate, or a direct RoleGrant-based path to STUDENT/
 * GUARDIAN, were both explicitly considered and rejected by Decision 269 (the first as
 * a bigger authority question than that decision was scoped to settle; the second as
 * redundant against the existing self-service join-code path) — see that decision's
 * own text before widening this enum further.
 */
export enum GrantableRoleDto {
  INSTRUCTOR = 'INSTRUCTOR',
  BRANCH_STAFF = 'BRANCH_STAFF',
  SCHOOL_OWNER_MANAGER = 'SCHOOL_OWNER_MANAGER',
}

export class CreateRoleGrantDto {
  @ApiProperty({ enum: GrantableRoleDto })
  @IsEnum(GrantableRoleDto)
  role!: GrantableRoleDto;

  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiPropertyOptional({
    description:
      'Required when role=BRANCH_STAFF (must belong to schoolId). Optional for INSTRUCTOR — Phase 1\'s schema.prisma models a School-scoped Instructor grant (branchId null) as the default shape; see the Phase 2 summary for the §6.1 wording this follows rather than re-litigates.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
