import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * The only role-grant relationship this phase actually implements: School Owner/
 * Manager inviting an Instructor or Branch Staff member within their own School
 * (Spec §8.2: School Owner/Manager's scope explicitly includes "Instructor and Branch
 * Staff invitations"). This is deliberately NOT the full RoleGrant.role enum — granting
 * SCHOOL_OWNER_MANAGER, FRANCHISE_OWNER, STUDENT, or GUARDIAN has no confirmed
 * authorization rule anywhere (checked against Spec 55 §8.2, ultm8-domain-rules,
 * ultm8-nestjs-module, and the decision log) and is intentionally not accepted here —
 * see the Phase 2 summary's "RoleGrant authority matrix" note.
 */
export enum GrantableRoleDto {
  INSTRUCTOR = 'INSTRUCTOR',
  BRANCH_STAFF = 'BRANCH_STAFF',
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
