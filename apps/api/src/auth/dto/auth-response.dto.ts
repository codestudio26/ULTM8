import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

/**
 * Shared by login() and refresh() — both mint the identical pair (a fresh
 * 15-minute accessToken plus a fresh, rotated refreshToken), so one response
 * shape covers both rather than two near-duplicate DTOs.
 *
 * Decision 1/230 — login() returns a DIFFERENT shape (mustChangePasscode +
 * passcodeChangeToken, no accessToken/refreshToken at all) when the target
 * User's mustChangePasscode flag is set. Modeled here as one DTO with every
 * field optional rather than a oneOf/union schema — same "flag if the field
 * lists... drift from AuthService's actual return shapes" tolerance this
 * file's own header comment already accepts for response DTOs; a frontend
 * caller distinguishes the two shapes by checking which fields are present.
 */
export class LoginResponseDto {
  @ApiPropertyOptional()
  accessToken?: string;

  @ApiPropertyOptional()
  refreshToken?: string;

  @ApiPropertyOptional({ description: 'True when a forced passcode change is required before normal tokens are issued.' })
  mustChangePasscode?: true;

  @ApiPropertyOptional({ description: 'Present only alongside mustChangePasscode — pass to POST /auth/passcode-change/first-login, nowhere else.' })
  passcodeChangeToken?: string;
}
