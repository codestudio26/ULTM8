import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma, Role } from '@prisma/client';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { AuthService } from '../../auth/auth.service';
import { NotificationDeliveryService } from '../../notifications/notification-delivery.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { CoachInviteStatus, CreateCoachInviteDto, InviteRole } from './dto/coach-invite.dto';
import { ensureInstructorProfile } from '../../instructors/ensure-instructor-profile';
import { recordStaffActivity } from '../staff-activity/staff-activity';

/** Decision 183: a coach invite link works for 7 days. */
export const COACH_INVITE_TTL_DAYS = 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

interface InviteRow {
  id: string;
  schoolId: string;
  branchId: string | null;
  email: string;
  /** INSTRUCTOR or BRANCH_STAFF (CoachInvite_role_check). */
  role: Role;
  invitedById: string | null;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}

function statusOf(invite: Pick<InviteRow, 'acceptedAt' | 'cancelledAt' | 'expiresAt'>, now = new Date()): CoachInviteStatus {
  if (invite.acceptedAt) return 'ACCEPTED';
  if (invite.cancelledAt) return 'CANCELLED';
  if (invite.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
}

/**
 * Coach invites (Decision 183).
 *
 * The School's main owner invites one person by email (Decision 423 item 10:
 * only the main owner adds people; co-owners and Branch Staff no longer
 * invite, and the "Can invite coaches" switch is gone). The email carries a
 * link with a random token; only its SHA-256 is stored. The link is single
 * use, works for 7 days and can be cancelled. Accepting it, signed in with the
 * invited email, gives that account an INSTRUCTOR RoleGrant at the School (and
 * branch); any other role it holds, such as STUDENT, is kept.
 *
 * Decision 396: the main owner may also invite someone as Branch Staff, which
 * is how "Give role" works when the School's "New staff must accept first" is
 * on.
 *
 * An invite works while its sender is still an owner of the School
 * (coach_invite_by_token). Every invite sent since Decision 423 was sent by
 * the main owner; the ones co-owners and Branch Staff had open were cancelled
 * by migration 20270213000000_main_owner_grants_roles.
 */
@Injectable()
export class CoachInvitesService {
  private readonly logger = new Logger(CoachInvitesService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly authService: AuthService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  private portalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new ServiceUnavailableException('Coach invites are not set up yet: PORTAL_BASE_URL is not configured.');
    return url;
  }

  async create(callerId: string, schoolId: string, dto: CreateCoachInviteDto) {
    const email = dto.email.trim().toLowerCase();
    const branchId = dto.branchId ?? null;
    const role: InviteRole = dto.role ?? 'INSTRUCTOR';
    const baseUrl = this.portalBaseUrl();

    const { school, caller, branches } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      school: await tx.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } }),
      caller: await tx.user.findUnique({ where: { id: callerId }, select: { phoneVerifiedAt: true, firstName: true, surname: true } }),
      branches: await tx.branch.findMany({ where: { schoolId }, select: { id: true, name: true, archivedAt: true } }),
    }));
    if (!school) throw new NotFoundException('School not found');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    // Before the branch checks: staff only see their own branches, so a
    // branch they aren't at would otherwise read as "not this School's".
    await this.tenantAuth.assertSchoolMainOwner(callerId, schoolId);

    if (role === 'BRANCH_STAFF' && !branchId) throw new BadRequestException('Branch Staff need a branch (branchId).');
    // Decision 169: a coach belongs to a branch when the School has branches.
    if (branches.length > 0 && !branchId) {
      throw new BadRequestException('This School has branches: choose the branch this coach will be at (branchId).');
    }
    if (branches.length === 0 && branchId) throw new BadRequestException('This School has no branches; leave branchId out.');
    const branch = branchId ? branches.find((b) => b.id === branchId) : null;
    if (branchId && !branch) throw new BadRequestException('branchId must be a branch of this School.');
    // Decision 296: nobody new joins a Branch that is waiting to be purged.
    if (branch?.archivedAt) throw new BadRequestException('This branch has been archived. Choose another branch.');
    // Decision 81: whoever hands out a role must have a verified phone.
    if (!caller?.phoneVerifiedAt) {
      throw new ForbiddenException('Your account must complete phone verification (POST /auth/otp/verify) before you can invite coaches.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + COACH_INVITE_TTL_DAYS * 86_400_000);
    const invite = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const pending = await tx.coachInvite.findFirst({
        where: { schoolId, branchId, email, role, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (pending) throw new ConflictException('This person already has a pending invite here. Cancel it to send a new one.');
      const created = await tx.coachInvite.create({
        data: { id: randomUUID(), schoolId, branchId, email, role, tokenHash: hashToken(token), invitedById: callerId, expiresAt },
      });
      await recordStaffActivity(tx, { schoolId, actorId: callerId, action: 'INVITE_SENT', details: { email, role, branchName: branch?.name ?? null } });
      return created;
    });

    const inviter = caller ? `${caller.firstName} ${caller.surname}` : 'Your school';
    const where = branch ? `${school.name} (${branch.name})` : school.name;
    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        email,
        role === 'BRANCH_STAFF' ? `You're invited to join the staff at ${school.name}` : `You're invited to coach at ${school.name}`,
        [
          role === 'BRANCH_STAFF'
            ? `${inviter} has invited you to join the staff at ${where} on ULTM8, as Branch Staff.`
            : `${inviter} has invited you to coach at ${where} on ULTM8.`,
          '',
          `Open this link to accept. Sign in, or create your account, with this email address (${email}):`,
          `${baseUrl}/coach-invite/${token}`,
          '',
          `The link works once and expires in ${COACH_INVITE_TTL_DAYS} days.`,
          "If you weren't expecting this, you can ignore this email.",
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`Coach invite ${invite.id}: the email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ...this.toResponse(invite, branch?.name ?? null, inviter), emailSent };
  }

  /** The School's invites, for its owners: the main owner, who sends and
   * cancels them, and co-owners, who see them read only (Decision 423 item
   * 10). */
  async list(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const { invites, branches } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      invites: await tx.coachInvite.findMany({ where: { schoolId }, orderBy: { createdAt: 'desc' } }),
      branches: await tx.branch.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    }));
    const names = await resolveUserNames(this.prismaAuth, invites.map((i) => i.invitedById).filter((id): id is string => !!id));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    return {
      items: invites.map((i) => {
        const n = i.invitedById ? names.get(i.invitedById) : undefined;
        return this.toResponse(i, i.branchId ? branchName.get(i.branchId) ?? null : null, n ? `${n.firstName} ${n.surname}` : null);
      }),
    };
  }

  /** Cancel a pending invite; its link stops working. The School's main
   * owner only (Decision 423 item 10). RLS shows invites to owners alone, so
   * the invite's School is read first, unscoped: the School's own staff get
   * the same 403 as on every other add-or-remove path rather than a 404, and
   * outsiders still get the 404 RLS gave them. */
  async cancel(callerId: string, inviteId: string) {
    const target = await this.prismaJobs.coachInvite.findUnique({ where: { id: inviteId }, select: { schoolId: true } });
    if (!target) throw new NotFoundException('Invite not found');
    await this.tenantAuth.assertSchoolMainOwnerOrNotFound(callerId, target.schoolId, 'Invite not found');
    const invite = await this.prismaApp.withTenantContext(callerId, (tx) => tx.coachInvite.findUnique({ where: { id: inviteId } }));
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.acceptedAt) throw new ConflictException('This invite has already been accepted. Remove the coach role on the Staff page instead.');
    let updated = invite;
    if (!invite.cancelledAt) {
      // Only a still-open invite is cancelled: one accepted at this very
      // moment is a 409, not a 500 (stress round, finding 7).
      updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
        const done = await tx.coachInvite.updateMany({
          where: { id: inviteId, acceptedAt: null, cancelledAt: null },
          data: { cancelledAt: new Date(), cancelledById: callerId },
        });
        const now = await tx.coachInvite.findUniqueOrThrow({ where: { id: inviteId } });
        if (done.count === 0 && now.acceptedAt) {
          throw new ConflictException('This invite has just been accepted. Remove the coach role on the Staff page instead.');
        }
        if (done.count === 1) {
          const branch = now.branchId ? await tx.branch.findUnique({ where: { id: now.branchId }, select: { name: true } }) : null;
          await recordStaffActivity(tx, {
            schoolId: now.schoolId,
            actorId: callerId,
            action: 'INVITE_CANCELLED',
            details: { email: now.email, role: now.role, branchName: branch?.name ?? null },
          });
        }
        return now;
      });
    }
    const branch = updated.branchId
      ? await this.prismaApp.withTenantContext(callerId, (tx) => tx.branch.findUnique({ where: { id: updated.branchId! }, select: { name: true } }))
      : null;
    return this.toResponse(updated, branch?.name ?? null, null);
  }

  private async findByToken(token: string) {
    const rows = await this.prismaApp.$queryRaw<
      Array<InviteRow & { schoolName: string; schoolArchived: boolean; branchName: string | null; branchArchived: boolean; inviterMayInvite: boolean }>
    >`SELECT * FROM coach_invite_by_token(${hashToken(token)})`;
    return rows[0] ?? null;
  }

  /** The invite page: the School, branch and email, for whoever holds the link. */
  async preview(token: string) {
    const invite = await this.findByToken(token);
    if (!invite) throw new NotFoundException('This invite link is not valid.');
    // An invite from someone who may no longer invite, or to a closed School,
    // can't be accepted: shown as cancelled.
    const status = statusOf(invite) === 'PENDING' && !this.stillValid(invite) ? 'CANCELLED' : statusOf(invite);
    return { schoolName: invite.schoolName, branchName: invite.branchName, email: invite.email, role: invite.role as InviteRole, status, expiresAt: invite.expiresAt };
  }

  /** Accept, signed in with the invited email: the account gets the coach
   * role at the School (and branch) and keeps any role it already has. */
  async accept(callerId: string, token: string) {
    const invite = await this.findByToken(token);
    if (!invite) throw new NotFoundException('This invite link is not valid.');
    const status = statusOf(invite);
    if (status === 'ACCEPTED') throw new ConflictException('This invite has already been used.');
    if (status === 'CANCELLED') throw new GoneException('This invite was cancelled. Ask the school for a new one.');
    if (status === 'EXPIRED') throw new GoneException('This invite has expired. Ask the school for a new one.');
    // Still good at the moment of accepting (security review M1): the School
    // isn't closed, and whoever sent it may still invite to that branch.
    if (!this.stillValid(invite)) throw new GoneException('This invite is no longer valid. Ask the school for a new one.');

    const tokenHash = hashToken(token);
    const acceptInTx = () => this.prismaApp.withCoachInviteToken(callerId, tokenHash, async (tx) => {
      const me = await tx.user.findUnique({ where: { id: callerId }, select: { email: true } });
      if (!me || me.email.trim().toLowerCase() !== invite.email) {
        throw new ForbiddenException(`This invite is for ${invite.email}. Sign in with that email to accept it.`);
      }
      // Single use: only a pending, unexpired invite flips to accepted.
      const claimed = await tx.coachInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date(), acceptedById: callerId },
      });
      if (claimed.count !== 1) throw new ConflictException('This invite can no longer be accepted.');
      // Decision 390: someone paused gets their roles back when the School
      // unpauses them, not through an invite.
      const paused = await tx.roleGrant.findFirst({ where: { userId: callerId, schoolId: invite.schoolId, pausedAt: { not: null } }, select: { id: true } });
      if (paused) throw new ConflictException('Your roles at this School are paused. Ask the School to unpause you.');

      const existing = await tx.roleGrant.findFirst({
        where: { userId: callerId, schoolId: invite.schoolId, branchId: invite.branchId, role: invite.role, revokedAt: null },
      });
      await recordStaffActivity(tx, {
        schoolId: invite.schoolId,
        actorId: callerId,
        targetUserId: callerId,
        action: 'INVITE_ACCEPTED',
        details: { role: invite.role, branchName: invite.branchName },
      });
      const grant =
        existing ??
        (await tx.roleGrant.create({
          data: {
            id: randomUUID(),
            role: invite.role,
            userId: callerId,
            schoolId: invite.schoolId,
            branchId: invite.branchId,
            grantedById: invite.invitedById,
          },
        }));
      // A coach gets their (empty) coach profile with the role. Written as the
      // coach, whose live grant just made above is what lets them write it.
      if (invite.role === 'INSTRUCTOR') {
        await ensureInstructorProfile(tx, { userId: callerId, schoolId: invite.schoolId, branchId: invite.branchId });
      }
      return grant;
    });
    // RoleGrant_one_live_per_scope: the same coach role given at the same
    // moment another way (a second invite, the owner's "Give role") makes
    // this insert fail and roll back, invite claim included. Once more: the
    // check above then finds that grant and the invite is still accepted.
    const grant = await acceptInTx().catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return acceptInTx();
      throw err;
    });

    // Same as SchoolsService.join(): re-mint after the grant commits so the
    // new token carries the coach role.
    const accessToken = await this.authService.issueAccessToken(callerId);
    return { schoolId: grant.schoolId!, branchId: grant.branchId, role: invite.role as InviteRole, accessToken };
  }

  /** The caller's own staff permission here (Decision 184), for the portal:
   * "Can manage disciplines" (Decision 383). */
  async myStaffPermission(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId: callerId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { isOwner: true, canManageDisciplines: true };
      const permission = await tx.staffPermission.findUnique({
        where: { schoolId_userId: { schoolId, userId: callerId } },
        select: { canManageDisciplines: true },
      });
      const canManageDisciplines = !!permission?.canManageDisciplines && grants.some((g) => g.role === 'BRANCH_STAFF');
      return { isOwner: false, canManageDisciplines };
    });
  }

  /** Branch Staff at the School and whether each may manage disciplines. Owner only. */
  async listStaffPermissions(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const { grants, permissions } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({ where: { schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { userId: true, branchId: true } }),
      permissions: await tx.staffPermission.findMany({ where: { schoolId } }),
    }));
    const byUser = new Map<string, string[]>();
    for (const g of grants) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), ...(g.branchId ? [g.branchId] : [])]);
    const names = await resolveUserNames(this.prismaAuth, [...byUser.keys()]);
    const byPerson = new Map(permissions.map((p) => [p.userId, p]));
    const items = [...byUser.entries()].map(([userId, branchIds]) => ({
      userId,
      firstName: names.get(userId)?.firstName ?? '',
      surname: names.get(userId)?.surname ?? '',
      branchIds,
      canManageDisciplines: byPerson.get(userId)?.canManageDisciplines ?? false,
    }));
    items.sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`));
    return { items };
  }

  /** Give or take "Can manage disciplines" (Decision 383). The main owner only
   * (Decision 448 item 6);
   * Branch Staff only. */
  async setStaffPermission(callerId: string, schoolId: string, userId: string, change: { canManageDisciplines: boolean }) {
    const { canManageDisciplines } = change;
    // Decision 448 item 6: the main owner only.
    await this.tenantAuth.assertMaySetStaffSwitches(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const isStaff = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId, schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { id: true } }),
    );
    if (!isStaff) {
      throw new BadRequestException('"Can manage disciplines" is for Branch Staff only.');
    }
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const before = await tx.staffPermission.findUnique({
        where: { schoolId_userId: { schoolId, userId } },
        select: { canManageDisciplines: true },
      });
      await tx.staffPermission.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, canManageDisciplines, grantedById: callerId },
        update: { canManageDisciplines, grantedById: callerId },
      });
      // Decision 408: the same switch as on the Access window.
      if (canManageDisciplines !== (before?.canManageDisciplines ?? false)) {
        await recordStaffActivity(tx, { schoolId, actorId: callerId, targetUserId: userId, action: 'ACCESS_CHANGED', details: { changes: [{ switch: 'disciplines', on: canManageDisciplines }] } });
      }
    });
    return (await this.listStaffPermissions(callerId, schoolId)).items.find((i) => i.userId === userId)!;
  }

  private stillValid(invite: { schoolArchived: boolean; branchArchived: boolean; inviterMayInvite: boolean }): boolean {
    return !invite.schoolArchived && !invite.branchArchived && invite.inviterMayInvite;
  }

  /** Cancel the open invites someone sent once they may no longer invite
   * (their owner role here removed), so the list matches what still works.
   * Runs as the main owner. */
  async cancelOpenInvitesFrom(callerId: string, schoolId: string, inviterId: string) {
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.coachInvite.updateMany({
        where: { schoolId, invitedById: inviterId, acceptedAt: null, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledById: callerId },
      }),
    );
  }

  private toResponse(invite: InviteRow, branchName: string | null, invitedByName: string | null) {
    return {
      id: invite.id,
      schoolId: invite.schoolId,
      branchId: invite.branchId,
      branchName,
      email: invite.email,
      role: invite.role as InviteRole,
      status: statusOf(invite),
      invitedById: invite.invitedById,
      invitedByName,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      cancelledAt: invite.cancelledAt,
    };
  }
}
