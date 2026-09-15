import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * POST /platform-admin/impersonation-sessions body (Phase 43, Decision 102).
 * `userId` is the tenant User to impersonate — this endpoint does not itself
 * provide a way to look one up by email/name; the caller is assumed to already
 * know it (from a support ticket, an existing cross-tenant read, etc.). A
 * dedicated "find a tenant User by identifying detail" capability is a
 * separate, unbuilt concern, not guessed at here.
 */
export class StartImpersonationSessionDto {
  @ApiProperty({ description: 'The tenant User id to impersonate.' })
  @IsUUID()
  userId!: string;
}
