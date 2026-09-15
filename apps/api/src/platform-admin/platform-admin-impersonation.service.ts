import { ForbiddenException, Injectable } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { AuthService } from '../auth/auth.service';
import { AuditLogService, AuditAction } from './audit-log.service';
import { StartImpersonationSessionDto } from './dto/start-impersonation-session.dto';

// Developer-level placeholder, same tier as PlatformAdminModule's own
// PLATFORM_ADMIN_JWT_TTL (see platform-admin.module.ts's own comment on that
// constant) — Decision 102 confirms "time-boxed" but names no specific number;
// Spec 55/the decision log leave this to the implementing phase. 10 minutes:
// long enough for a real troubleshooting look, short enough that "time-boxed"
// means something concrete rather than matching or exceeding an ordinary
// 15-minute tenant login session.
const IMPERSONATION_SESSION_TTL_SECONDS = Number(process.env.PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS ?? 600);

/**
 * PlatformAdminModule Slice 8 (Phase 43) — Decision 102 (resolved directly with
 * the user, docs/decisions/POST-SPEC-55-DECISION-LOG.md): Support-tier
 * impersonation is read-only. Mechanically, this is the ONE piece of this
 * module that hands back a genuine TENANT-realm JWT rather than acting itself —
 * see AuthService.issueImpersonationToken()'s own header comment for why the
 * actual token-minting logic lives in AuthModule (where JWT_ACCESS_SECRET
 * naturally lives) rather than here, and JwtStrategy's own comment for how
 * read-only is enforced globally with no changes needed to any of this
 * codebase's ~20 existing tenant controllers.
 *
 * SUPPORT + FULL_ADMIN, not SUPPORT alone: ultm8-tenant-isolation SKILL.md §3
 * names this capability only under the Support bullet, but every other
 * subRole-gated write/read in this module already includes FULL_ADMIN
 * alongside the narrower tier it's confirmed for — see
 * PlatformAdminPaymentAccountsService's own header comment for the reasoning
 * this reuses verbatim ("every confirmed FULL_ADMIN capability in the spec is
 * a superset of the narrower tiers' own").
 *
 * KNOWN LIMITATION, flagged not silently skipped: only the session's own START
 * is audit-logged (AuditAction.START_IMPERSONATION_SESSION). ultm8-tenant-
 * isolation §6's confirmed audit-trigger list ("viewing/editing another
 * tenant's records... impersonating a tenant user") could be read as requiring
 * every individual read taken DURING an active session to be logged too, not
 * just the session start — that reading isn't confirmed either way (Decision
 * 102 left session mechanics, which this would be part of, to the implementing
 * phase). Building it would mean the tenant-side JwtStrategy (a foundational,
 * cross-tenant-agnostic file AuthModule owns) reaching into PlatformAdminModule's
 * own AuditLogService/Postgres role on every single tenant request — a real
 * module-layering concern, not a small addition — so it's deliberately deferred
 * rather than built unreviewed into the one file every tenant request already
 * passes through.
 */
@Injectable()
export class PlatformAdminImpersonationService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly authService: AuthService,
    private readonly auditLog: AuditLogService,
  ) {}

  async startSession(callerId: string, dto: StartImpersonationSessionDto) {
    await this.assertSupportOrFullAdmin(callerId);

    const { accessToken, expiresAt } = await this.authService.issueImpersonationToken(
      dto.userId,
      callerId,
      IMPERSONATION_SESSION_TTL_SECONDS,
    );

    // Session START only — see this class's own header comment for what's
    // deliberately not logged here.
    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.START_IMPERSONATION_SESSION,
      targetType: 'User',
      targetId: dto.userId,
    });

    return { accessToken, expiresAt: expiresAt.toISOString(), impersonatedUserId: dto.userId };
  }

  private async assertSupportOrFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (
      !caller ||
      caller.revokedAt ||
      (caller.subRole !== AdminSubRole.SUPPORT && caller.subRole !== AdminSubRole.FULL_ADMIN)
    ) {
      throw new ForbiddenException('Only Support or a Full Platform Admin may start an impersonation session (Decision 102).');
    }
  }
}
