import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { frontDeskSessionJwt, verifyFrontDeskSessionToken } from './front-desk-session-token';
import { checkInCodeDigits, withUniqueCode } from './check-in-code';

/** How long a locked tablet stays in front-desk mode before staff start it
 * again (Decision 380: a working day and the night after it). */
export const FRONT_DESK_SESSION_HOURS = 24;

/** Wrong staff codes a tablet accepts before its session ends (Decision 388).
 * Five tries a minute for 24 hours would otherwise be enough to guess a 4-digit
 * code; a staff member starts the tablet again. */
export const FRONT_DESK_MAX_WRONG_CODES = 10;

/** Wrong member check-in codes in a row before the tablet locks until a staff
 * code is typed (Decision 417): codes are short, and at a big School a random
 * guess is often someone's. */
export const FRONT_DESK_MAX_WRONG_MEMBER_CODES = 10;

/** Wrong member check-in codes within FRONT_DESK_WRONG_MEMBER_CODE_WINDOW_MS
 * that also lock the tablet, whatever right codes come between (stress test
 * round 5, PRIV-8; amends Decision 417 item 4). Without it, someone who knew
 * one code could type 9 guesses, then that code, for ever. A busy desk rarely
 * types 20 wrong codes in half an hour. */
export const FRONT_DESK_MAX_WRONG_MEMBER_CODES_IN_WINDOW = 20;
export const FRONT_DESK_WRONG_MEMBER_CODE_WINDOW_MS = 30 * 60_000;

/** The Redis key holding one session's recent wrong member codes. */
export function wrongMemberCodesKey(sessionId: string): string {
  return `front-desk:wrong-member-codes:${sessionId}`;
}

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
  /** Locked after too many wrong member codes (Decision 417). */
  lockedAt: Date | null;
}

const SESSION_ENDED = { code: 'FRONT_DESK_SESSION_ENDED', message: 'This front-desk session has ended. Ask a member of staff to start it again.' };
/** The tablet is locked (Decision 417): every kiosk call but a few answers this. */
export const FRONT_DESK_LOCKED = {
  code: 'FRONT_DESK_LOCKED',
  message: 'Too many wrong check-in codes, so this tablet is locked. Ask a member of staff to type their code.',
};
const TOO_MANY_WRONG_CODES = {
  code: 'FRONT_DESK_SESSION_ENDED',
  message: 'Too many wrong staff codes, so this front-desk session has ended. Ask a member of staff to start it again.',
};

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
    // Only for its Redis connection: the rolling count of wrong member codes.
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly redisQueue: Queue,
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
   * once the session has ended or expired, once whoever started it is no
   * longer staff there, or once the School or the tablet's Branch is closed
   * (Decision 388). */
  async authenticate(token: string): Promise<FrontDeskSessionContext> {
    const sessionId = verifyFrontDeskSessionToken(token);
    if (!sessionId) throw new UnauthorizedException(SESSION_ENDED);
    const session = await this.prismaJobs.frontDeskSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt || session.expiresAt <= new Date()) throw new UnauthorizedException(SESSION_ENDED);
    const [starterStillStaff, school, branch] = await Promise.all([
      this.holdsGrant(session.startedById, session.schoolId, session.branchId, STARTER_ROLES),
      this.prismaJobs.school.findUnique({ where: { id: session.schoolId }, select: { archivedAt: true } }),
      session.branchId ? this.prismaJobs.branch.findUnique({ where: { id: session.branchId }, select: { archivedAt: true } }) : null,
    ]);
    const branchClosed = session.branchId !== null && (!branch || branch.archivedAt !== null);
    if (!starterStillStaff || !school || school.archivedAt || branchClosed) throw new UnauthorizedException(SESSION_ENDED);
    return {
      id: session.id,
      schoolId: session.schoolId,
      branchId: session.branchId,
      startedById: session.startedById,
      expiresAt: session.expiresAt,
      lockedAt: session.lockedAt,
    };
  }

  /** POST /front-desk/kiosk/unlock: a staff member types their own code on the
   * tablet. Ends the session and records who it was (Decision 320). A wrong
   * code is logged and counted; the route is rate-limited per session, and the
   * FRONT_DESK_MAX_WRONG_CODES-th wrong code ends the session (Decision 388). */
  async unlock(session: FrontDeskSessionContext, code: string) {
    const match = await this.matchStaffCode(session, code);
    await this.prismaApp.withTenantContext(match.userId, (tx) =>
      tx.frontDeskSession.updateMany({ where: { id: session.id, endedAt: null }, data: { endedAt: new Date(), endedById: match.userId } }),
    );
    const names = await resolveUserNames(this.prismaAuth, [match.userId]);
    return { unlockedBy: names.get(match.userId)?.firstName ?? '' };
  }

  /** POST /front-desk/kiosk/resume: a staff member types their own code on a
   * tablet locked by wrong member codes (Decision 417). The tablet carries on
   * in front-desk mode and the count starts again. A wrong staff code counts
   * as on the exit screen. */
  async resume(session: FrontDeskSessionContext, code: string) {
    const match = await this.matchStaffCode(session, code);
    await this.prismaApp.withTenantContext(session.startedById, (tx) =>
      tx.frontDeskSession.updateMany({ where: { id: session.id, endedAt: null }, data: { lockedAt: null, wrongMemberCodeCount: 0 } }),
    );
    await this.clearWrongMemberCodeWindow(session.id);
    if (session.lockedAt) this.logger.log(`Front-desk session ${session.id} (School ${session.schoolId}) unlocked by staff ${match.userId}`);
    const names = await resolveUserNames(this.prismaAuth, [match.userId]);
    return { resumedBy: names.get(match.userId)?.firstName ?? '' };
  }

  /** A member code typed on the tablet was wrong (Decision 417). Counted in
   * one statement, like wrong staff codes; at FRONT_DESK_MAX_WRONG_MEMBER_CODES
   * in a row the tablet locks, and this answers with the lock. It also locks
   * at FRONT_DESK_MAX_WRONG_MEMBER_CODES_IN_WINDOW wrong codes in the last 30
   * minutes, right codes between them or not (PRIV-8). */
  async countWrongMemberCode(session: FrontDeskSessionContext): Promise<void> {
    const inWindow = await this.countInWrongMemberCodeWindow(session.id);
    const windowFull = inWindow !== null && inWindow >= FRONT_DESK_MAX_WRONG_MEMBER_CODES_IN_WINDOW;
    const wrong = await this.prismaApp.withTenantContext(session.startedById, async (tx) => {
      const row = await tx.frontDeskSession.update({
        where: { id: session.id },
        data: { wrongMemberCodeCount: { increment: 1 } },
        select: { wrongMemberCodeCount: true },
      });
      if (row.wrongMemberCodeCount >= FRONT_DESK_MAX_WRONG_MEMBER_CODES || windowFull) {
        await tx.frontDeskSession.updateMany({ where: { id: session.id, lockedAt: null }, data: { lockedAt: new Date() } });
      }
      return row.wrongMemberCodeCount;
    });
    if (wrong >= FRONT_DESK_MAX_WRONG_MEMBER_CODES || windowFull) {
      this.logger.warn(
        `Front-desk session ${session.id} (School ${session.schoolId}) locked after ${wrong} wrong member codes in a row, ${inWindow ?? '?'} in the last 30 minutes`,
      );
      throw new HttpException(FRONT_DESK_LOCKED, 423);
    }
  }

  /** Adds one wrong member code to the session's 30-minute window in Redis
   * and returns how many the window holds. A sorted set of timestamps, so the
   * window rolls; it expires with its newest entry. Null when Redis can't be
   * reached: the "in a row" count above still locks the tablet. */
  private async countInWrongMemberCodeWindow(sessionId: string): Promise<number | null> {
    try {
      const redis = (await this.redisQueue.client) as unknown as IORedis;
      const key = wrongMemberCodesKey(sessionId);
      const now = Date.now();
      const results = await redis
        .multi()
        .zremrangebyscore(key, 0, now - FRONT_DESK_WRONG_MEMBER_CODE_WINDOW_MS)
        .zadd(key, now, `${now}:${randomUUID()}`)
        .zcard(key)
        .pexpire(key, FRONT_DESK_WRONG_MEMBER_CODE_WINDOW_MS)
        .exec();
      const [err, count] = results?.[2] ?? [null, null];
      if (err || typeof count !== 'number') throw err ?? new Error('no count');
      return count;
    } catch (err) {
      this.logger.warn(`Front-desk session ${sessionId}: wrong member code not added to the 30-minute count — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Staff unlocked the tablet: its 30-minute window starts again too. */
  private async clearWrongMemberCodeWindow(sessionId: string): Promise<void> {
    try {
      const redis = await this.redisQueue.client;
      await redis.del(wrongMemberCodesKey(sessionId));
    } catch (err) {
      this.logger.warn(`Front-desk session ${sessionId}: 30-minute wrong-code count not cleared — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** A right member code starts the "in a row" count again. The 30-minute
   * window is left as it is (PRIV-8). */
  async resetWrongMemberCodes(session: FrontDeskSessionContext): Promise<void> {
    await this.prismaApp.withTenantContext(session.startedById, (tx) =>
      tx.frontDeskSession.updateMany({ where: { id: session.id, wrongMemberCodeCount: { gt: 0 } }, data: { wrongMemberCodeCount: 0 } }),
    );
  }

  // ---------------------------------------------------------------------------

  /** The staff member whose own code this is, if they're staff covering the
   * tablet's Branch; otherwise the wrong code is counted and refused. */
  private async matchStaffCode(session: FrontDeskSessionContext, code: string) {
    const match = await this.prismaJobs.staffKioskCode.findUnique({ where: { schoolId_code: { schoolId: session.schoolId, code } } });
    const allowed = match ? await this.holdsGrant(match.userId, session.schoolId, session.branchId, STAFF_ROLES) : false;
    if (!match || !allowed) {
      await this.countWrongCode(session);
      throw new ForbiddenException({ code: 'WRONG_STAFF_CODE', message: "That staff code isn't right." });
    }
    return match;
  }

  /** Counts a wrong staff code on the session, and ends it at the limit. Runs
   * as the staff member who started it: a tablet has no login of its own, and
   * the starter is still staff there (the guard checked). The count goes up in
   * one statement, so codes typed at once can't all slip under the limit. */
  private async countWrongCode(session: FrontDeskSessionContext): Promise<void> {
    const wrong = await this.prismaApp.withTenantContext(session.startedById, async (tx) => {
      const row = await tx.frontDeskSession.update({ where: { id: session.id }, data: { wrongCodeCount: { increment: 1 } }, select: { wrongCodeCount: true } });
      if (row.wrongCodeCount >= FRONT_DESK_MAX_WRONG_CODES) {
        await tx.frontDeskSession.updateMany({ where: { id: session.id, endedAt: null }, data: { endedAt: new Date() } });
      }
      return row.wrongCodeCount;
    });
    if (wrong >= FRONT_DESK_MAX_WRONG_CODES) {
      this.logger.warn(`Front-desk session ${session.id} (School ${session.schoolId}) ended after ${wrong} wrong staff codes`);
      throw new UnauthorizedException(TOO_MANY_WRONG_CODES);
    }
    this.logger.warn(`Wrong staff code on front-desk session ${session.id} (School ${session.schoolId}), ${wrong} of ${FRONT_DESK_MAX_WRONG_CODES}`);
  }

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

  /** A fresh code of the School's length, unique there. */
  private async issueCode(userId: string, schoolId: string): Promise<string> {
    return withUniqueCode(await checkInCodeDigits(this.prismaJobs, schoolId), (code) =>
      this.prismaApp.withTenantContext(userId, (tx) =>
        tx.staffKioskCode.upsert({ where: { schoolId_userId: { schoolId, userId } }, create: { schoolId, userId, code }, update: { code } }),
      ),
    );
  }
}
