import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * POST /platform-admin/impersonation-sessions body (Phase 43, Decision 102;
 * `schoolId` added per Spec 55 §12.1 Decision 39 — see
 * AuthService.issueImpersonationToken()'s own header comment for the full
 * account of the gap this closes). `userId` is the tenant User to impersonate —
 * this endpoint does not itself provide a way to look one up by email/name; the
 * caller is assumed to already know it (from a support ticket, an existing
 * cross-tenant read, etc.). A dedicated "find a tenant User by identifying
 * detail" capability is a separate, unbuilt concern, not guessed at here.
 *
 * `schoolId` is "the specific tenant identified when impersonation was
 * initiated" (Decision 39's own wording) — the one School the support case is
 * actually about. Required, not optional: Decision 39 exists specifically
 * because an unscoped token silently inherited every School (and Franchise) the
 * target user holds any RoleGrant at, which is real cross-tenant exposure for
 * anyone impersonating a multi-School Instructor or a Franchise Owner.
 */
export class StartImpersonationSessionDto {
  @ApiProperty({ description: 'The tenant User id to impersonate.' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ description: 'The one School this impersonation session is scoped to (Decision 39) — not the target user\'s other Schools/Franchises, if any.' })
  @IsUUID()
  schoolId!: string;
}
