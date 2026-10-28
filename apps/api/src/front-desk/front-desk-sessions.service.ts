import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { frontDeskSessionJwt, verifyFrontDeskSessionToken } from './front-desk-session-token';

/** How long a locked tablet stays in front-desk mode before staff start it
 * again (Decision 380: a working day and the night after it). */
export const FRONT_DESK_SESSION_HOURS = 24;

const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'] as const;
// Who may start a tablet (handover F1): the owner, or Branch Staff for their Branch.
const STARTER_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] as const;

/** The session a kiosk request runs under, as the guard found it. */
export interface FrontDeskSessionContext {
  id: string;
  schoolId: string;
  branchId: string | null;
  /** The kiosk's reads and check-ins use this staff member's access, through
   * the kiosk endpoints only. */
  startedById: string;
  expiresAt: Date;
}

const SESSION_ENDED = { code: 'FRONT_DESK_SESSION_ENDED', message: 'This front-desk session has ended. Ask a member of staff to start it again.' };

/**
 * Locked front-desk tablets (Decisions 317, 320, 351, 380; handover F1, F2).
 * Staff start a session for one Branch; the tablet then holds only the
 * session's token, and the portal signs the staff member out of it. A staff
 * member's own kiosk code ends it on the tablet; staff can also end it from
 * the Check-in page.
 */
@Injectable()
export class FrontDeskSessionsService {
  private readonly logger = new Logger(FrontDeskSessionsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** POST /schools/{schoolId}/front-desk/sessions. `branchId` is required when
   * the School has open Branches, and must be null when it has none. */
  async start(callerId: string, schoolId: string, branchId: string | null) {
    const branches = await this.prismaJobs.branch.findMany({ where: { schoolId, archivedAt: null }, select: { id: true } });
    if (branches.length > 0 && !branches.some((b) => b.id === branchId)) {
      throw new BadRequestException('Pick one of the School\'s open Branches for this tablet.');
    }
    if (branches.length === 0 && branchId) {
      throw new BadRequestException('This School has no Branches: start front-desk mode for the whole School.');
    }
    if (!(await this.holdsGrant(callerId, schoolId, branchId, STARTER_ROLES))) {
      throw new ForbiddenException('Only the School owner, or Branch Staff at this Branch, can start front-desk mode.');
    }
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const expiresAt = new Date(Date.now() + FRONT_DESK_SESSION_HOURS * 3_600_000);
    const session = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.frontDeskSession.create({ data: { schoolId, branchId, startedById: callerId, expiresAt } }),
    );
    const jwt = frontDeskSessionJwt();
    if (!jwt) throw new Error('JWT_ACCESS_SECRET is not set');
    const sessionToken = jwt.sign(
      { sid: session.id, sub: `front-desk:${session.id}`, typ: 'front-desk-session' },
      { expiresIn: FRONT_DESK_SESSION_HOURS * 3600 },
    );
    return { sessionId: session.id, sessionToken, branchId, expiresAt: expiresAt.toISOString() };
  }

  /** GET /schools/{schoolId}/front-desk/sessions: the tablets in front-desk
   * mode now, at the Branches the caller works at. */
  async listActive(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.frontDeskSession.findMany({
        where: { schoolId, endedAt: null, expiresAt: { gt: new Date() } },
        include: { branch: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const names = await resolveUserNames(this.prismaAuth, rows.map((r) => r.startedById));
    return {
      items: rows.map((r) => {
        const who = names.get(r.startedById);
        return {
          id: r.id,
          branchId: r.branchId,
          branchName: r.branch?.name ?? null,
          startedById: r.startedById,
          startedByName: who ? `${who.firstName} ${who.surname}`.trim() : '',
          startedAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
        };
      }),
    };
  }

  /** POST /schools/{schoolId}/front-desk/sessions/{id}/end: staff end a
   * tablet's session from their own login (a lost tablet, or nobody with a
   * code at the desk). */
  async end(callerId: string, schoolId: string, sessionId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const result = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.frontDeskSession.updateMany({ where: { id: sessionId, schoolId, endedAt: null }, data: { endedAt: new Date(), endedById: callerId } }),
    );
    if (result.count === 0) throw new NotFoundException('Front-desk session not found, or already ended.');
    return { ended: true };
  }

  /** GET /schools/{schoolId}/front-desk/my-code: the caller's own kiosk code
   * here, made the first time it's asked for (Decision 320 item 3). */
  async myCode(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.staffKioskCode.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } } }));
    if (existing) return { code: existing.code };
    return { code: await this.issueCode(callerId, schoolId) };
  }

  /** POST /schools/{schoolId}/front-desk/my-code: a new code, for when the old
   * one was seen by someone else. */
  async newCode(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    return { code: await this.issueCode(callerId, schoolId) };
  }

  /** The kiosk guard: the live session a front-desk token belongs to. Refused
   * once the session has ended or expired, or once whoever started it is no
   * longer staff there. */
  async authenticate(token: string): Promise<FrontDeskSessionContext> {
    const sessionId = verifyFrontDeskSessionToken(token);
    if (!sessionId) throw new UnauthorizedException(SESSION_ENDED);
    const session = await this.prismaJobs.frontDeskSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt || session.expiresAt <= new Date()) throw new UnauthorizedException(SESSION_ENDED);
    const [starterStillStaff, school] = await Promise.all([
      this.holdsGrant(session.startedById, session.schoolId, session.branchId, STARTER_ROLES),
      this.prismaJobs.school.findUnique({ where: { id: session.schoolId }, select: { archivedAt: true } }),
    ]);
    if (!starterStillStaff || !school || school.archivedAt) throw new UnauthorizedException(SESSION_ENDED);
    return { id: session.id, schoolId: session.schoolId, branchId: session.branchId, startedById: session.startedById, expiresAt: session.expiresAt };
  }

  /** POST /front-desk/kiosk/unlock: a staff member types their own code on the
   * tablet. Ends the session and records who it was (Decision 320). A wrong
   * code is logged; the route is rate-limited per session. */
  async unlock(session: FrontDeskSessionContext, code: string) {
    const match = await this.prismaJobs.staffKioskCode.findUnique({ where: { schoolId_code: { schoolId: session.schoolId, code } } });
    const allowed = match ? await this.holdsGrant(match.userId, session.schoolId, session.branchId, STAFF_ROLES) : false;
    if (!match || !allowed) {
      this.logger.warn(`Wrong staff code on front-desk session ${session.id} (School ${session.schoolId})`);
      throw new ForbiddenException({ code: 'WRONG_STAFF_CODE', message: "That staff code isn't right." });
    }
    await this.prismaApp.withTenantContext(match.userId, (tx) =>
      tx.frontDeskSession.updateMany({ where: { id: session.id, endedAt: null }, data: { endedAt: new Date(), endedById: match.userId } }),
    );
    const names = await resolveUserNames(this.prismaAuth, [match.userId]);
    return { unlockedBy: names.get(match.userId)?.firstName ?? '' };
  }

  // ---------------------------------------------------------------------------

  /** An active grant of one of `roles` at the School that covers `branchId`
   * (a School-wide grant covers every Branch). Read via ultm8_jobs: a kiosk
   * request has no user context, and the caller's own context can't see
   * someone else's grants. */
  private async holdsGrant(userId: string, schoolId: string, branchId: string | null, roles: readonly string[]): Promise<boolean> {
    const grant = await this.prismaJobs.roleGrant.findFirst({
      where: {
        userId,
        schoolId,
        revokedAt: null,
        role: { in: roles as never },
        ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
      },
      select: { id: true },
    });
    return grant !== null;
  }

  /** A fresh random code of the School's length, unique there. Retries on the
   * rare clash with another staff member's code. */
  private async issueCode(userId: string, schoolId: string): Promise<string> {
    const school = await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { checkInCodeDigits: true } });
    const digits = school?.checkInCodeDigits === 6 ? 6 : 4;
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = String(randomInt(0, 10 ** digits)).padStart(digits, '0');
      try {
        await this.prismaApp.withTenantContext(userId, (tx) =>
          tx.staffKioskCode.upsert({
            where: { schoolId_userId: { schoolId, userId } },
            create: { schoolId, userId, code },
            update: { code },
          }),
        );
        return code;
      } catch (err) {
        if ((err as { code?: string })?.code !== 'P2002') throw err;
      }
    }
    throw new Error('Could not issue a unique staff code');
  }
}
