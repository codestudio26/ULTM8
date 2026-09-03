import { ApiProperty } from '@nestjs/swagger';

/**
 * Response-shape DTOs — added in Phase 3 so packages/api-client's generated client is
 * actually typed on responses, not just requests. Phase 1/2 controllers never declared
 * response schemas (no @ApiResponse/@ApiOkResponse anywhere), so the OpenAPI spec they
 * produced had no response schema at all for any endpoint — silently only half of what
 * ultm8-nestjs-module §3 requires ("packages/api-client... the one source of truth for
 * request/response shapes"). This closes that gap for AuthModule's endpoints. A
 * Developer-level addition serving Phase 3 item 1 directly, not a new business
 * decision — flag if the field lists below drift from AuthService's actual return
 * shapes.
 */
export class AuthMessageResponseDto {
  @ApiProperty()
  message!: string;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;
}
