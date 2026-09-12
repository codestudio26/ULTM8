import { ApiProperty } from '@nestjs/swagger';
import { AdminSubRole } from '@prisma/client';

/** Response DTOs for PlatformAdminAuthController — same "response shape for
 * packages/api-client generation" convention as auth/dto/auth-response.dto.ts. */
export class AdminAuthResponseDto {
  @ApiProperty()
  accessToken!: string;
}

/** GET /platform-admin/auth/me — a deliberately minimal "who am I" endpoint proving
 * the exchange->guard->claims chain works end-to-end, not a real admin business-logic
 * endpoint (none exist yet — see PlatformAdminModule's own header comment on scope). */
export class AdminMeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: AdminSubRole })
  subRole!: AdminSubRole;
}
