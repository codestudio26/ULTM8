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
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { AuthService } from '../../auth/auth.service';
import { NotificationDeliveryService } from '../../notifications/notification-delivery.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { CoachInviteStatus, CreateCoachInviteDto } from './dto/coach-invite.dto';

/** Decision 183: a coach invite link works for 7 days. */
export const COACH_INVITE_TTL_DAYS = 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

interface InviteRow {
  id: string;
  schoolId: string;
  branchId: string | null;
  email: string;
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
 * Coach invites and "Can invite coaches" (Decision 183).
 *
 * The owner, or Branch Staff the owner has given "Can invite coaches" for
 * their own branches, invite one person by email. The email carries a link
 * with a random token; only its SHA-256 is stored. The link is single use,
 * works for 7 days and can be cancelled. Accepting it, signed in with the
 * invited email, gives that account an INSTRUCTOR RoleGrant at the School (and
 * branch); any other role it holds, such as STUDENT, is kept. Instructors can't
 * be given "Can invite coaches" (Spec 55 §8.2: no instructor management).
 */
@Injectable()
export class CoachInvitesService {
  private readonly logger = new Logger(CoachInvitesService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly authService: AuthService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  /** The owner may invite to any branch; Branch Staff with "Can invite
   * coaches" only to a branch where they are Branch Staff. */
  private async assertMayInvite(callerId: string, schoolId: string, branchId: string | null) {
    const [ownerGrant, permission, staffGrant] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.roleGrant.findFirst({ where: { userId: callerId, schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { id: true } }),
        tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { canInviteCoaches: true } }),
        tx.roleGrant.findFirst({ where: { userId: callerId, schoolId, branchId, role: 'BRANCH_STAFF', revokedAt: null }, select: { id: true } }),
      ]),
    );
    if (ownerGrant) return;
    if (permission?.canInviteCoaches && staffGrant) return;
    if (permission?.canInviteCoaches) throw new ForbiddenException('You can only invite coaches to your own branches.');
    throw new ForbiddenException('Only the School owner, or staff given "Can invite coaches", can invite coaches.');
  }

  private portalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new ServiceUnavailableException('Coach invites are not set up yet: PORTAL_BASE_URL is not configured.');
    return url;
  }

  async create(callerId: string, schoolId: string, dto: CreateCoachInviteDto) {
    const email = dto.email.trim().toLowerCase();
    const branchId = dto.branchId ?? null;
    const baseUrl = this.portalBaseUrl();

    const { school, caller, branches } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      school: await tx.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } }),
      caller: await tx.user.findUnique({ where: { id: callerId }, select: { phoneVerifiedAt: true, firstName: true, surname: true } }),
      branches: await tx.branch.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    }));
    if (!school) throw new NotFoundException('School not found');
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    // Before the branch checks: staff only see their own branches, so a
    // branch they aren't at would otherwise read as "not this School's".
    await this.assertMayInvite(callerId, schoolId, branchId);

    // Decision 169: a coach belongs to a branch when the School has branches.
    if (branches.length > 0 && !branchId) {
      throw new BadRequestException('This School has branches: choose the branch this coach will be at (branchId).');
    }
    if (branches.length === 0 && branchId) throw new BadRequestException('This School has no branches; leave branchId out.');
    const branch = branchId ? branches.find((b) => b.id === branchId) : null;
    if (branchId && !branch) throw new BadRequestException('branchId must be a branch of this School.');
    // Decision 81: whoever hands out a role must have a verified phone.
    if (!caller?.phoneVerifiedAt) {
      throw new ForbiddenException('Your account must complete phone verification (POST /auth/otp/verify) before you can invite coaches.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + COACH_INVITE_TTL_DAYS * 86_400_000);
    const invite = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const pending = await tx.coachInvite.findFirst({
        where: { schoolId, branchId, email, acceptedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (pending) throw new ConflictException('This person already has a pending invite here. Cancel it to send a new one.');
      return tx.coachInvite.create({
        data: { id: randomUUID(), schoolId, branchId, email, tokenHash: hashToken(token), invitedById: callerId, expiresAt },
      });
    });

    const inviter = caller ? `${caller.firstName} ${caller.surname}` : 'Your school';
    const where = branch ? `${school.name} (${branch.name})` : school.name;
    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        email,
        `You're invited to coach at ${school.name}`,
        [
          `${inviter} has invited you to coach at ${where} on ULTM8.`,
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

  /** The School's invites the caller may manage (RLS: all of them for the
   * owner, their own branches' for staff with "Can invite coaches"). */
  async list(callerId: string, schoolId: string) {
    const isOwner = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId: callerId, schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { id: true } }),
    );
    if (!isOwner) {
      const permission = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { canInviteCoaches: true } }),
      );
      if (!permission?.canInviteCoaches) {
        throw new ForbiddenException('Only the School owner, or staff given "Can invite coaches", can see coach invites.');
      }
    }
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

  /** Cancel a pending invite; its link stops working. */
  async cancel(callerId: string, inviteId: string) {
    const invite = await this.prismaApp.withTenantContext(callerId, (tx) => tx.coachInvite.findUnique({ where: { id: inviteId } }));
    if (!invite) throw new NotFoundException('Invite not found');
    await this.assertMayInvite(callerId, invite.schoolId, invite.branchId);
    if (invite.acceptedAt) throw new ConflictException('This invite has already been accepted. Remove the coach role on the Staff page instead.');
    const updated = invite.cancelledAt
      ? invite
      : await this.prismaApp.withTenantContext(callerId, (tx) =>
          tx.coachInvite.update({ where: { id: inviteId }, data: { cancelledAt: new Date(), cancelledById: callerId } }),
        );
    const branch = updated.branchId
      ? await this.prismaApp.withTenantContext(callerId, (tx) => tx.branch.findUnique({ where: { id: updated.branchId! }, select: { name: true } }))
      : null;
    return this.toResponse(updated, branch?.name ?? null, null);
  }

  private async findByToken(token: string) {
    const rows = await this.prismaApp.$queryRaw<
      Array<InviteRow & { schoolName: string; branchName: string | null }>
    >`SELECT * FROM coach_invite_by_token(${hashToken(token)})`;
    return rows[0] ?? null;
  }

  /** The invite page: the School, branch and email, for whoever holds the link. */
  async preview(token: string) {
    const invite = await this.findByToken(token);
    if (!invite) throw new NotFoundException('This invite link is not valid.');
    return { schoolName: invite.schoolName, branchName: invite.branchName, email: invite.email, status: statusOf(invite), expiresAt: invite.expiresAt };
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

    const tokenHash = hashToken(token);
    const grant = await this.prismaApp.withCoachInviteToken(callerId, tokenHash, async (tx) => {
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

      const existing = await tx.roleGrant.findFirst({
        where: { userId: callerId, schoolId: invite.schoolId, branchId: invite.branchId, role: 'INSTRUCTOR', revokedAt: null },
      });
      if (existing) return existing;
      return tx.roleGrant.create({
        data: {
          id: randomUUID(),
          role: 'INSTRUCTOR',
          userId: callerId,
          schoolId: invite.schoolId,
          branchId: invite.branchId,
          grantedById: invite.invitedById,
        },
      });
    });

    // Same as SchoolsService.join(): re-mint after the grant commits so the
    // new token carries the coach role.
    const accessToken = await this.authService.issueAccessToken(callerId);
    return { schoolId: grant.schoolId!, branchId: grant.branchId, accessToken };
  }

  /** The caller's own invite rights here (Decision 184), for the portal. */
  async myStaffPermission(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const grants = await tx.roleGrant.findMany({
        where: { userId: callerId, schoolId, role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] }, revokedAt: null },
        select: { role: true, branchId: true },
      });
      if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return { isOwner: true, canInviteCoaches: true, branchIds: [] };
      const permission = await tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: { canInviteCoaches: true } });
      const branchIds = [...new Set(grants.map((g) => g.branchId).filter((id): id is string => !!id))];
      const canInviteCoaches = !!permission?.canInviteCoaches && branchIds.length > 0;
      return { isOwner: false, canInviteCoaches, branchIds: canInviteCoaches ? branchIds : [] };
    });
  }

  /** Branch Staff at the School and whether each may invite coaches. Owner only. */
  async listStaffPermissions(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const { grants, permissions } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({ where: { schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { userId: true, branchId: true } }),
      permissions: await tx.staffPermission.findMany({ where: { schoolId } }),
    }));
    const byUser = new Map<string, string[]>();
    for (const g of grants) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), ...(g.branchId ? [g.branchId] : [])]);
    const names = await resolveUserNames(this.prismaAuth, [...byUser.keys()]);
    const allowed = new Map(permissions.map((p) => [p.userId, p.canInviteCoaches]));
    const items = [...byUser.entries()].map(([userId, branchIds]) => ({
      userId,
      firstName: names.get(userId)?.firstName ?? '',
      surname: names.get(userId)?.surname ?? '',
      branchIds,
      canInviteCoaches: allowed.get(userId) ?? false,
    }));
    items.sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`));
    return { items };
  }

  /** Give or take "Can invite coaches". Owner only; Branch Staff only. */
  async setStaffPermission(callerId: string, schoolId: string, userId: string, canInviteCoaches: boolean) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const isStaff = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId, schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { id: true } }),
    );
    if (!isStaff) {
      throw new BadRequestException('"Can invite coaches" is for Branch Staff only. Coaches can\'t invite coaches (Spec 55 §8.2).');
    }
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.staffPermission.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, canInviteCoaches, grantedById: callerId },
        update: { canInviteCoaches, grantedById: callerId },
      }),
    );
    return (await this.listStaffPermissions(callerId, schoolId)).items.find((i) => i.userId === userId)!;
  }

  private toResponse(invite: InviteRow, branchName: string | null, invitedByName: string | null) {
    return {
      id: invite.id,
      schoolId: invite.schoolId,
      branchId: invite.branchId,
      branchName,
      email: invite.email,
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
