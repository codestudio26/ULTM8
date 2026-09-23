import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for POST /platform-admin/impersonation-sessions (Phase 43, Decision
 * 102). `accessToken` is a genuine tenant-realm JWT — verified by the SAME
 * JwtStrategy/JwtAuthGuard every ordinary tenant request already goes through,
 * not a Platform-Admin-realm token — see AuthService.issueImpersonationToken()'s
 * own header comment. The caller (a Platform Admin frontend) is expected to use
 * it exactly like a tenant app would: `Authorization: Bearer <accessToken>`
 * against the ordinary tenant API surface. Every write attempt on it is rejected
 * by JwtStrategy itself (read-only, Decision 102) — this response carries no
 * separate "read-only" flag because that constraint isn't optional or visible
 * to the caller to toggle.
 */
export class ImpersonationSessionResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ description: 'ISO datetime this session (and the token itself) expires.' })
  expiresAt!: string;

  @ApiProperty()
  impersonatedUserId!: string;
}
