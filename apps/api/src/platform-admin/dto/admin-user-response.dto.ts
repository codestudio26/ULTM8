import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminSubRole } from '@prisma/client';

/** Response DTO — field-for-field match of the AdminUser Prisma model, minus
 * `ssoSubject` (an internal federated-identity linkage with no direct caller
 * action tied to it, and arguably sensitive — same "deliberately not exposed"
 * treatment this codebase already gives internal correlator ids like
 * Franchise.stripeMeterId). */
export class AdminUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: AdminSubRole })
  subRole!: AdminSubRole;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  revokedAt!: string | null;
}

export class AdminUserListResponseDto {
  @ApiProperty({ type: [AdminUserResponseDto] })
  items!: AdminUserResponseDto[];
}
