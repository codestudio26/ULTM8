import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** All 6 confirmed RoleGrant.role values (Spec §8.2, schema.prisma's Role enum) — the
 * response can reflect any grant type the caller is allowed to see, even though this
 * endpoint only ever CREATES Instructor/Branch Staff grants (Decision 80/81). */
export type RoleGrantRole =
  | 'STUDENT'
  | 'SCHOOL_OWNER_MANAGER'
  | 'BRANCH_STAFF'
  | 'INSTRUCTOR'
  | 'FRANCHISE_OWNER'
  | 'GUARDIAN';

/** Response shape — see school-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type`). Field-for-field match of the RoleGrant
 * Prisma model. */
export class RoleGrantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['STUDENT', 'SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR', 'FRANCHISE_OWNER', 'GUARDIAN'] })
  role!: RoleGrantRole;

  @ApiProperty()
  userId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  franchiseId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  schoolId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  grantedById!: string | null;

  @ApiProperty()
  grantedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  revokedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class RoleGrantListResponseDto {
  @ApiProperty({ type: [RoleGrantResponseDto] })
  items!: RoleGrantResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
