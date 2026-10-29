import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import {
  DEFAULT_STAFF_ACCESS,
  STAFF_ACCESS,
  STAFF_ACCESS_SELECT,
  StaffAccessSet,
  TenantAuthorizationService,
  staffAccessFrom,
} from '../tenant-authorization.service';
import { CoachInvitesService } from '../coach-invites/coach-invites.service';
import { SchoolsService } from '../schools/schools.service';
import { NotificationDeliveryService } from '../../notifications/notification-delivery.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../../jobs/queue.constants';
import { cancelPlacesOfLeavingStudent } from '../../bookings/leaving-student-cancellation';
import { cancelSubscriptionAtPeriodEnd } from '../../memberships/cancel-subscription';
import { StripeClientService } from '../../payments/stripe-client.service';
import { CreateRoleGrantDto } from './dto/create-role-grant.dto';
import { LookupInviteCandidateQueryDto } from './dto/lookup-invite-candidate-query.dto';
import { CreateStaffManuallyDto } from './dto/create-staff-manually.dto';
import { CreateStudentManuallyDto } from './dto/create-student-manually.dto';
import { isAdultOn } from '../../common/decorators/is-birth-date.decorator';
import { STAFF_ROLES, StaffAccessDto, StaffListQueryDto, StaffMemberDto, StaffRole, UpdateStaffDetailsDto } from './dto/staff-list.dto';
import { StepUpService } from '../../auth/step-up.service';
import { RolesChangedService } from '../../common/prisma/roles-changed.service';

const BCRYPT_ROUNDS = 12;

/** Display label per GrantableRoleDto value, for the "you've been granted..."
 * notification email's subject/body — this endpoint only ever creates these three
 * (see GrantableRoleDto in CreateRoleGrantDto), so no other role needs an entry here. */
const ROLE_LABELS: Record<string, string> = {
  INSTRUCTOR: 'Instructor',
  BRANCH_STAFF: 'Branch Staff',
  SCHOOL_OWNER_MANAGER: 'Owner/Manager',
};

/**
 * The roles this endpoint is authorized to REVOKE (v1.2 backend backlog —
 * Student Detail's/Instructor Detail's "Revoke Enrollment" action) — a
 * strictly wider set than GrantableRoleDto, since revoking an existing
 * grant is a different, narrower authorization question than creating one:
 * STUDENT is deliberately excluded from GrantableRoleDto (see its own header
 * comment — "granting... STUDENT... has no confirmed authorization rule"),
 * but that's about who may self-service-enroll vs. be invited; it says
 * nothing about whether a School Owner/Manager may end an EXISTING Student's
 * enrollment, which has its own confirmed basis (the v1.2 backlog's own
 * "Revoke Enrollment action... Proposed" entry for Student Detail,
 * Instructor's own identical gap tracked right beside it). Revoking a
 * STUDENT grant through revoke() below is purely additive: every existing
 * INSTRUCTOR/BRANCH_STAFF caller is unaffected, and the method's own
 * gradingPermission/staffPermission cleanup below is already keyed to those
 * two roles specifically, so a STUDENT revoke simply finds nothing to clean
 * up there (a pure Student never holds either).
 */
const REVOCABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF', 'STUDENT'] as const;

/** Decision 390 — a coach or Branch Staff role that is live, or paused (ended
 * for now, given back by Unpause). A paused person is still on the staff: the
 * School keeps what it set for them, and Remove from School still applies. */
export const LIVE_OR_PAUSED = { OR: [{ revokedAt: null }, { pausedAt: { not: null } }] } satisfies Prisma.RoleGrantWhereInput;

@Injectable()
export class RoleGrantsService {
  private readonly logger = new Logger(RoleGrantsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly coachInvites: CoachInvitesService,
    private readonly schoolsService: SchoolsService,
    private readonly delivery: NotificationDeliveryService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
    private readonly stripeClient: StripeClientService,
    private readonly rolesChanged: RolesChangedService,
    private readonly stepUp: StepUpService,
  ) {}

  /** Same convention as CoachInvitesService/InstructorsService's own
   * portalBaseUrl() — called only from inside create()'s non-blocking email
   * try/catch below, never ahead of the grant itself: unlike a coach-invite
   * link or an Add-Manually temp passcode, this notification isn't the only
   * way the grantee learns of or can use their new role (they already have an
   * account and can just log in), so a missing/misconfigured env var must not
   * block the grant. */
  private portalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new Error('PORTAL_BASE_URL is not configured.');
    return url;
  }

  /**
   * School Owner/Manager granting Instructor or Branch Staff within their own School
   * (Spec §8.2), or — as of Decision 270 — another SCHOOL_OWNER_MANAGER at that same
   * School (co-ownership/succession). See CreateRoleGrantDto's header comment for why
   * every other role/grantor combination remains out of scope.
   */
  async create(callerId: string, targetUserId: string, dto: CreateRoleGrantDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, dto.schoolId);
    // Decision 110 — a closed School accepts no further writes; Add Manually
    // below already checked this, this path didn't (Decision 296).
    await this.tenantAuth.assertSchoolNotArchived(callerId, dto.schoolId);

    // The verification gate from "we verify the accounts" (Decision 80) applies to the
    // GRANTOR, not the grantee — corrected by Decision 81 after the product owner was
    // asked directly, which ruled out the target-side check this originally had.
    // Checked fresh against the DB (not the JWT, which carries no phoneVerifiedAt
    // claim) via the caller's own ordinary RLS-scoped context — this is a self-lookup
    // (user_self_or_shared_school's "id = current_setting(...)" clause), so it doesn't
    // need PrismaAuthService's pre-tenant-context bypass the way the target-existence
    // check below does.
    const caller = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.findUnique({ where: { id: callerId }, select: { phoneVerifiedAt: true, firstName: true, surname: true } }),
    );
    if (!caller?.phoneVerifiedAt) {
      throw new ForbiddenException(
        'Your account must complete phone verification (POST /auth/otp/verify) before you can grant roles.',
      );
    }

    if (dto.role === 'BRANCH_STAFF' && !dto.branchId) {
      throw new BadRequestException('branchId is required when role is BRANCH_STAFF');
    }

    // SCHOOL_OWNER_MANAGER has no Branch concept (assertSchoolOwner's own query is
    // School-scoped only, no branchId column) — reject a branchId outright rather than
    // silently ignore it, so a caller never thinks they scoped an Owner/Manager grant
    // to one Branch when the grant is actually School-wide.
    if (dto.role === 'SCHOOL_OWNER_MANAGER' && dto.branchId) {
      throw new BadRequestException('branchId must not be provided when role is SCHOOL_OWNER_MANAGER — this role is School-wide.');
    }

    // Target user must exist — no verification precondition on the target as of
    // Decision 81 (see above). Uses PrismaAuthService (see its header comment) because
    // no shared RoleGrant exists yet to make the target visible via the ordinary
    // RLS-scoped path.
    const targetUser = await this.prismaAuth.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, firstName: true },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: dto.schoolId }, select: { id: true, name: true } }),
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Decision 169: an instructor always belongs to something. In a School
    // with branches that is a branch (one grant per branch for an instructor
    // who teaches at several, Decision 168); a School with no branches is
    // itself the branch, so the grant stays School-wide.
    if (dto.role === 'INSTRUCTOR' && !dto.branchId) {
      const anyBranch = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.branch.findFirst({ where: { schoolId: dto.schoolId }, select: { id: true } }),
      );
      if (anyBranch) {
        throw new BadRequestException(
          'This School has branches: choose the branch this instructor belongs to (branchId). Add one grant per branch for an instructor who teaches at several.',
        );
      }
    }

    let branchName: string | null = null;
    if (dto.branchId) {
      const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.branch.findUnique({ where: { id: dto.branchId }, select: { id: true, schoolId: true, name: true, archivedAt: true } }),
      );
      if (!branch || branch.schoolId !== dto.schoolId) {
        throw new BadRequestException('branchId must reference a Branch belonging to schoolId');
      }
      // Decision 296: nobody new joins a Branch that is waiting to be purged.
      if (branch.archivedAt) {
        throw new BadRequestException('This branch has been archived. Choose another branch.');
      }
      branchName = branch.name;
    }

    const duplicate = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId: targetUserId,
          schoolId: dto.schoolId,
          branchId: dto.branchId ?? null,
          role: dto.role,
          revokedAt: null,
        },
        select: { id: true },
      }),
    );
    const duplicateMessage = 'This user already holds an active grant of this role at this scope.';
    if (duplicate) {
      throw new ConflictException(duplicateMessage);
    }
    // Decision 390: a paused person gets their roles back with Unpause. A new
    // coach or Branch Staff role meanwhile would quietly end the pause.
    if (dto.role !== 'SCHOOL_OWNER_MANAGER') await this.assertNotPaused(callerId, dto.schoolId, targetUserId);

    const roleGrantId = randomUUID();
    let grant;
    try {
      grant = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.roleGrant.create({
          data: {
            id: roleGrantId,
            role: dto.role,
            userId: targetUserId,
            schoolId: dto.schoolId,
            branchId: dto.branchId,
            grantedById: callerId,
          },
        }),
      );
    } catch (err) {
      // The check above can't see a twin request that is still inserting (a
      // double click on "Give role"); RoleGrant_one_live_per_scope stops the
      // second one, and it gets the same answer the check gives.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(duplicateMessage);
      }
      throw err;
    }
    // Decision 361: their current access token is refused on its next use and
    // the app refreshes it with the new grant, so the role works straight away.
    this.rolesChanged.forget(targetUserId);

    // "You've been granted the Instructor role..." notification — previously
    // missing entirely: the grant itself always succeeded, but the invited
    // user had no way to learn about it short of noticing it themselves on
    // next login. Non-blocking, same emailSent shape CoachInvitesService.
    // create()/InstructorsService.createManually() already established — the
    // grant above has already committed, so a delivery failure here (or
    // PORTAL_BASE_URL being unset) must never undo or appear to undo it.
    const roleLabel = ROLE_LABELS[dto.role] ?? dto.role;
    const where = branchName ? `${school.name} (${branchName})` : school.name;
    const inviter = caller.firstName || caller.surname ? `${caller.firstName} ${caller.surname}` : 'Your school';
    let emailSent = true;
    try {
      const baseUrl = this.portalBaseUrl();
      await this.delivery.sendEmail(
        targetUser.email,
        `You've been granted the ${roleLabel} role at ${school.name}`,
        [
          `${inviter} has granted you the ${roleLabel} role at ${where} on ULTM8.`,
          '',
          'Sign in to see it:',
          `${baseUrl}/login`,
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`RoleGrant ${grant.id}: the notification email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ...grant, emailSent };
  }

  /** Strict variant of portalBaseUrl() above, for createStaffManually() only — mirrors
   * InstructorsService's own private portalBaseUrl() exactly. Unlike create()'s
   * "you've been granted a role" notification (which isn't the only way the grantee
   * learns of their new role — they already have an account and can just log in), a
   * temp-passcode email from Add Manually genuinely IS the only way the new Staff
   * member can ever learn their own passcode, so this must fail LOUD and BEFORE
   * anything is created, not swallowed inside a non-blocking try/catch. */
  private strictPortalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new ServiceUnavailableException('Staff "Add Manually" is not set up yet: PORTAL_BASE_URL is not configured.');
    return url;
  }

  /**
   * POST /schools/:schoolId/role-grants/add-manually (Decision 251) — Staff "Add
   * Manually", closing the exact gap Decision 237's own "What this does NOT resolve"
   * section flagged: "Whether AccountInvitation... should still exist for Staff's own
   * identical from-zero-invite gap." The product owner's own direct answer, when asked:
   * "Yes — same pattern as Instructor: real User+RoleGrant created immediately, temp
   * passcode emailed, forced change on first login."
   *
   * Lives here on RoleGrantsService, not as a new module/controller, because
   * RoleGrantsService already owns all Staff CRUD (GrantableRoleDto) — "Staff" is
   * not a separate Role or profile table the way Instructor is its own table; it IS a
   * RoleGrant row with role: 'BRANCH_STAFF'. So unlike
   * InstructorsService.createManually() (User + RoleGrant + a third Instructor profile
   * row), this method creates only User + RoleGrant — there is no third row to create.
   *
   * branchId is REQUIRED outright (CreateStaffManuallyDto's own validation), not
   * conditional on whether the School has branches the way Instructor's own add-
   * manually flow is — Branch Staff always needs a branchId, full stop (same rule
   * create() above already enforces for an existing-user BRANCH_STAFF grant, and the
   * same thing StaffPage.tsx's own `needsBranch` logic already assumes client-side).
   *
   * School Owner/Manager only — same gate create() above already uses (Spec §8.2).
   */
  async createStaffManually(callerId: string, schoolId: string, dto: CreateStaffManuallyDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const email = dto.email.trim().toLowerCase();
    const baseUrl = this.strictPortalBaseUrl();

    // Branch Staff always belongs to a specific Branch — CreateStaffManuallyDto
    // already makes branchId required at the validation layer; this just checks it
    // actually belongs to this School, same as create()'s own branchId check below.
    await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
    // Decision 296: nobody new joins a Branch that is waiting to be purged.
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findUnique({ where: { id: dto.branchId }, select: { archivedAt: true } }),
    );
    if (branch?.archivedAt) {
      throw new BadRequestException('This branch has been archived. Choose another branch.');
    }

    // Decision 116's existing-email check, same PrismaAuthService pre-tenant-context
    // lookup InstructorsService.createManually()/create() below/AuthService.register()
    // all already use — closes the risk of two divergent paths (Add Manually vs. an
    // existing account) ever producing two accounts for one person.
    const existingUser = await this.prismaAuth.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists — use "Invite staff" instead.');
    }

    const userId = randomUUID();
    const roleGrantId = randomUUID();
    const tempPasscode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const passcodeHash = await bcrypt.hash(tempPasscode, BCRYPT_ROUNDS);

    const grant = await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      // Bootstrap trick (AuthService.register()'s own pattern, reused by
      // InstructorsService.createManually()/GuardiansService.createMinor()): User's RLS
      // WITH CHECK only permits inserting a row whose id equals the CURRENT tenant
      // context, so the new Staff member's User row is created under ITS OWN
      // (about-to-exist) id.
      await setContext(userId);
      await tx.user.create({
        data: {
          id: userId,
          email,
          firstName: dto.firstName,
          surname: dto.surname,
          passcodeHash,
          mustChangePasscode: true,
          // phone/dateOfBirth deliberately left null — filled in by the Staff
          // member themselves after their first login, same as Instructor's own
          // Add Manually flow.
        },
      });

      await setContext(callerId);
      return tx.roleGrant.create({
        data: { id: roleGrantId, role: 'BRANCH_STAFF', userId, schoolId, branchId: dto.branchId, grantedById: callerId },
      });
    });

    // Same non-blocking-email-failure shape as CoachInvitesService.create()/
    // InstructorsService.createManually(): creation already succeeded; only the
    // delivery can fail independently of it.
    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        email,
        'Your ULTM8 staff account is ready',
        [
          "You've been added as Staff on ULTM8.",
          '',
          `Sign in with this email address (${email}) and the temporary passcode below — you'll be asked to choose your own passcode right away.`,
          '',
          `Temporary passcode: ${tempPasscode}`,
          '',
          `${baseUrl}/login`,
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`Staff RoleGrant ${grant.id}: the temp-passcode email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ...grant, userFirstName: dto.firstName, userSurname: dto.surname, email, emailSent };
  }

  /**
   * POST /schools/:schoolId/students/add-manually (Decision 371) — the owner
   * enrols an adult with no ULTM8 account yet: same pattern as Staff/Instructor
   * Add Manually (a real account at once, a temporary passcode emailed, a new
   * one chosen at first sign-in, in the student app). Enrolment itself goes
   * through join(), so the home branch, waivers and the closed-School check are
   * exactly an Invite's. The branch is checked before the account is created,
   * so a wrong branch never leaves an account behind.
   */
  async createStudentManually(callerId: string, schoolId: string, dto: CreateStudentManuallyDto) {
    const school = await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (!isAdultOn(new Date(dto.dateOfBirth))) {
      throw new BadRequestException("Add manually is for adults (18 or over). A child joins through their Guardian's app.");
    }

    const branches = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findMany({ where: { schoolId }, select: { id: true, archivedAt: true } }),
    );
    const chosen = dto.branchId ? branches.find((b) => b.id === dto.branchId) : undefined;
    if (dto.branchId && !chosen) throw new BadRequestException('branchId must be a branch of this School.');
    if (chosen?.archivedAt) throw new BadRequestException('This branch has been archived. Choose another branch.');
    if (!dto.branchId && branches.some((b) => !b.archivedAt)) {
      throw new BadRequestException('This School has branches: choose your home branch (branchId).');
    }

    const email = dto.email.trim().toLowerCase();
    const { userId, tempPasscode } = await this.createStudentAccount({ email, firstName: dto.firstName, surname: dto.surname, dateOfBirth: dto.dateOfBirth });
    await this.enrolNewAccount(userId, () => this.schoolsService.join(callerId, schoolId, { studentId: userId, branchId: dto.branchId }, { notify: false }));

    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        email,
        `You've been added to ${school.name} on ULTM8`,
        [
          `${school.name} has added you as a student on ULTM8.`,
          '',
          `Sign in to the ULTM8 app with this email address (${email}) and the temporary passcode below. You'll be asked to choose your own passcode straight away.`,
          '',
          `Temporary passcode: ${tempPasscode}`,
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`Student ${userId}: the temp-passcode email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }
    // Email isn't always set up (or can fail): the owner then gets the
    // passcode once, to hand over in person, instead of an account nobody can
    // sign in to.
    return { id: userId, firstName: dto.firstName, surname: dto.surname, email, emailSent, temporaryPasscode: emailSent ? null : tempPasscode };
  }

  /**
   * A new adult student's account (Decision 371, and tablet sign-ups,
   * Decision 392): a temporary passcode, changed at first sign-in. 409 if the
   * email already has an account. Enrol it with enrolNewAccount.
   */
  async createStudentAccount(data: { email: string; firstName: string; surname: string; dateOfBirth: string | Date; gender?: string | null }) {
    const email = data.email.trim().toLowerCase();
    const existingUser = await this.prismaAuth.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists — use "Invite" instead.');
    }

    const userId = randomUUID();
    const tempPasscode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const passcodeHash = await bcrypt.hash(tempPasscode, BCRYPT_ROUNDS);
    // The bootstrap trick createStaffManually uses: a User row may only be
    // inserted under its own (about-to-exist) id.
    await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      await setContext(userId);
      try {
        await tx.user.create({
          data: {
            id: userId,
            email,
            firstName: data.firstName,
            surname: data.surname,
            dateOfBirth: new Date(data.dateOfBirth),
            gender: data.gender ?? undefined,
            passcodeHash,
            mustChangePasscode: true,
          },
        });
      } catch (err) {
        // Two adds of the same email at once: the second loses the unique index.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('An account with this email already exists — use "Invite" instead.');
        }
        throw err;
      }
    });
    return { userId, tempPasscode };
  }

  /** Runs `join` for an account createStudentAccount just made. join() runs
   * its own transaction, so a failure there (a timeout under load, a branch
   * archived meanwhile) left an account with no enrolment and no passcode
   * email, and retrying the same email got "use Invite". The account just
   * made is removed, then the error rethrown; only if it holds no grant at
   * all: if the enrolment did commit, the account stays. */
  async enrolNewAccount<T>(userId: string, join: () => Promise<T>): Promise<T> {
    try {
      return await join();
    } catch (err) {
      await this.prismaApp
        .withTenantContext(userId, (tx) => tx.user.deleteMany({ where: { id: userId, roleGrants: { none: {} } } }))
        .catch((cleanupErr) =>
          this.logger.error(`Student ${userId}: enrolment failed and the new account could not be removed — ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`),
        );
      throw err;
    }
  }

  /**
   * Exact email/phone match only, never a name search (Decision 116) — the invite
   * target has no RoleGrant at this School yet, so user_self_or_shared_school can't
   * cover the read; this is a lookup-then-confirm step ahead of create(), which
   * remains untouched. Uses PrismaAuthService (see its own header comment), the same
   * pre-tenant-context bypass create()'s own target-existence-by-id check already
   * uses, generalized to accept email/phone instead of only a known id.
   *
   * School Owner/Manager only, gated *before* the lookup runs — an exact-match lookup
   * can confirm whether an email/phone is registered, the same class of exposure
   * AuthService.register()'s own already-taken check already accepts for any
   * anonymous caller; here the caller must already hold a real SCHOOL_OWNER_MANAGER
   * grant, a materially higher bar, so this isn't a new risk category.
   */
  async lookupInviteCandidate(callerId: string, schoolId: string, query: LookupInviteCandidateQueryDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    if (!query.email && !query.phone) {
      throw new BadRequestException('email or phone is required');
    }

    const candidate = await this.prismaAuth.user.findFirst({
      where: {
        OR: [...(query.email ? [{ email: query.email }] : []), ...(query.phone ? [{ phone: query.phone }] : [])],
      },
      select: { id: true, firstName: true, surname: true, email: true },
    });

    if (!candidate) {
      return { found: false, id: null, firstName: null, surname: null, email: null };
    }
    return { found: true, id: candidate.id, firstName: candidate.firstName, surname: candidate.surname, email: candidate.email };
  }

  /** List a user's role grants — RLS shows the caller their own grants, or (as of this
   * phase) any grant scoped to a School they hold SCHOOL_OWNER_MANAGER on. */
  async findAllForUser(
    callerId: string,
    targetUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.roleGrant.findMany({ ...args, where: { userId: targetUserId } }), cursor, limit),
    );
    // Resolved via PrismaAuthService (Decision 117), not a Prisma `include` on
    // RoleGrant.user — an RLS-scoped include can silently fail to resolve the
    // target's own User row once ALL their RoleGrants at this School are revoked
    // (this endpoint deliberately still returns revoked rows), even though this
    // caller is fully authorized to see those rows. See resolveUserNames's own
    // header comment. Every row shares the same targetUserId, so this lookup is
    // redundant per-row — accepted anyway to match the established per-DTO embed
    // convention (Decision 109/110) rather than a one-off envelope shape.
    const names = await resolveUserNames(this.prismaAuth, page.items.map((g) => g.userId));
    return {
      ...page,
      items: page.items.map((g) => ({
        ...g,
        userFirstName: names.get(g.userId)?.firstName ?? '',
        userSurname: names.get(g.userId)?.surname ?? '',
      })),
    };
  }

  /** Cancels at period end every live Stripe Subscription the student holds
   * at this School, when this is their last STUDENT grant there. Same "in
   * effect" test as the Revoke dialog's leaving-summary. */
  private async stopSubscriptionsOfLeavingStudent(callerId: string, schoolId: string, studentId: string, roleGrantId: string): Promise<void> {
    const now = new Date();
    const subscriptions = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const otherGrants = await tx.roleGrant.count({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null, id: { not: roleGrantId } } });
      if (otherGrants > 0) return [];
      return tx.membership.findMany({
        where: {
          schoolId,
          studentId,
          status: 'ACTIVE',
          stripeSubscriptionId: { not: null },
          cancelAt: null,
          OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
        },
        select: { id: true, schoolId: true, status: true, stripeSubscriptionId: true, cancelAt: true },
      });
    });
    for (const membership of subscriptions) {
      try {
        await this.prismaApp.withTenantContext(callerId, (tx) => cancelSubscriptionAtPeriodEnd(this.stripeClient, tx, membership, callerId));
      } catch (err) {
        // Nothing here can cancel it (e.g. the School's Stripe account is
        // gone): the owner deals with it in Stripe; it mustn't block leaving.
        if (err instanceof BadRequestException) {
          this.logger.warn(`Revoke ${roleGrantId}: Subscription Membership ${membership.id} not cancelled — ${err.message}`);
          continue;
        }
        this.logger.warn(`Revoke ${roleGrantId}: Stripe refused to cancel Membership ${membership.id} — ${err instanceof Error ? err.message : String(err)}`);
        throw new ServiceUnavailableException("Stripe couldn't stop this student's Subscription, so they haven't been removed. Please try again in a moment.");
      }
    }
  }

  /** Revoke = set revokedAt (soft — RoleGrant is an auditable history, never hard-deleted). */
  async revoke(callerId: string, targetUserId: string, roleGrantId: string) {
    const grant = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findUnique({ where: { id: roleGrantId } }),
    );
    if (!grant || grant.userId !== targetUserId) {
      throw new NotFoundException('RoleGrant not found');
    }
    // Decision 370: owners are equal co-owners and may remove each other,
    // except the main owner, whom only a Platform Admin can remove.
    const isOwnerGrant = grant.role === 'SCHOOL_OWNER_MANAGER';
    if (!isOwnerGrant && !REVOCABLE_ROLES.includes(grant.role as (typeof REVOCABLE_ROLES)[number])) {
      throw new ForbiddenException('This endpoint may only revoke SCHOOL_OWNER_MANAGER, INSTRUCTOR, BRANCH_STAFF, or STUDENT grants.');
    }
    if (!grant.schoolId) {
      throw new ForbiddenException('This endpoint may only revoke School-scoped grants.');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, grant.schoolId);

    if (grant.revokedAt && grant.pausedAt) {
      // Decision 390: removing a paused role ends it for good, so Unpause no
      // longer gives it back.
      const schoolId = grant.schoolId;
      const removed = await this.prismaApp.withTenantContext(callerId, async (tx) => {
        const row = await tx.roleGrant.update({ where: { id: roleGrantId }, data: { pausedAt: null, pausedById: null } });
        await this.clearCoachRightsIfGone(tx, targetUserId, schoolId);
        return row;
      });
      if (grant.role === 'BRANCH_STAFF') await this.coachInvites.cancelOpenInvitesFrom(callerId, schoolId, targetUserId, grant.branchId);
      return removed;
    }
    if (grant.revokedAt) {
      return grant; // already revoked — idempotent, not an error
    }

    const schoolId = grant.schoolId;
    if (grant.role === 'INSTRUCTOR') await this.assertNoClassesLeftWithoutInstructor(callerId, grant.id, targetUserId, schoolId);
    // Leaving the School stops their Subscriptions at the end of the paid
    // period (Decision 343). Done first, each in its own transaction around
    // the Stripe call: if Stripe refuses, nothing is revoked and the owner can
    // try again; if the revoke below then fails, a retry finds the
    // Subscription already cancelled and moves on.
    if (grant.role === 'STUDENT') await this.stopSubscriptionsOfLeavingStudent(callerId, schoolId, targetUserId, roleGrantId);
    let freedClassIds: string[] = [];
    const revoked = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      if (isOwnerGrant && (await mainOwnerGrant(tx, schoolId))?.id === grant.id) {
        throw new ForbiddenException({
          code: 'MAIN_OWNER',
          message: "The main owner can't be removed here. To change the main owner, contact ULTM8 support.",
        });
      }
      const row = await tx.roleGrant.update({ where: { id: roleGrantId }, data: { revokedAt: new Date() } });
      await this.clearCoachRightsIfGone(tx, targetUserId, schoolId);
      // A home branch belongs to an enrolment (Decision 341, S13): left
      // behind, it blocked re-enrolling (one per School and student) and
      // archiving the branch (Decision 252). Re-enrolling picks one again.
      if (grant.role === 'STUDENT') {
        const stillEnrolled = await tx.roleGrant.count({ where: { userId: targetUserId, schoolId, role: 'STUDENT', revokedAt: null } });
        if (stillEnrolled === 0) {
          await tx.studentHomeBranch.deleteMany({ where: { schoolId, studentId: targetUserId } });
          // Someone who has left gives up their seats and waitlist places
          // (Decision 343, S2).
          ({ freedClassIds } = await cancelPlacesOfLeavingStudent(tx, schoolId, targetUserId, callerId, this.logger));
        }
      }
      return row;
    });
    // Branch Staff no longer at that branch can't have coach invites open
    // there (Decision 183; security review M1).
    if (grant.role === 'BRANCH_STAFF') await this.coachInvites.cancelOpenInvitesFrom(callerId, grant.schoolId, targetUserId, grant.branchId);
    // Enqueued after commit and only logged on failure, like cancelBooking():
    // a Redis hiccup must not undo the revoke.
    for (const classId of freedClassIds) {
      try {
        await this.waitlistCascadeQueue.add('seat-freed', { classId });
      } catch (err) {
        this.logger.warn(`Failed to enqueue waitlist-cascade-processing for Class ${classId} after revoking ${roleGrantId}: ${err}`);
      }
    }
    // Decision 361: their current access token stops working on its next use.
    this.rolesChanged.forget(targetUserId);
    return revoked;
  }

  /** Given the role again later, they start with today's permissions, not
   * their old ones (Decision 193). Cleared only once they hold no coach role
   * at this School, so losing one branch keeps the others' rights. A paused
   * role still counts (Decision 390): Unpause gives back the same rights. */
  private async clearCoachRightsIfGone(tx: Prisma.TransactionClient, userId: string, schoolId: string) {
    const remaining = await tx.roleGrant.findMany({
      where: { userId, schoolId, ...LIVE_OR_PAUSED, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] } },
      select: { role: true },
    });
    if (remaining.length === 0) await tx.gradingPermission.deleteMany({ where: { userId, schoolId } });
    if (!remaining.some((g) => g.role === 'BRANCH_STAFF')) {
      // Every Branch Staff switch goes back to its default (Decision 387).
      await tx.staffPermission.updateMany({ where: { userId, schoolId }, data: toPermissionColumns(DEFAULT_STAFF_ACCESS) });
    }
  }

  /**
   * GET /schools/{schoolId}/staff (Decision 361) — everyone who holds, or held,
   * an owner, coach or Branch Staff role at this School, one row per person
   * with their roles grouped. Replaces looking people up by User ID.
   *
   * Owners see everyone; Branch Staff with "See the staff list" get a
   * read-only view (Decision 387, listStaffForBranchStaff). Grants are read under the owner's own tenant
   * context (an owner already sees every grant at their School, ended ones
   * too). Names and contact details come through PrismaAuthService, like
   * findAllForUser(): once all of someone's roles here have ended, the ordinary
   * RLS path can no longer see their User row, and the Removed filter needs it.
   * A School's staff is small, so the whole list comes back in one response.
   */
  async listStaff(callerId: string, schoolId: string, query: StaffListQueryDto) {
    if (!(await this.tenantAuth.isSchoolOwner(callerId, schoolId))) {
      return this.listStaffForBranchStaff(callerId, schoolId, query);
    }

    const { grants, branches, permissions, main } = await this.prismaApp.withTenantContext(callerId, async (tx) => ({
      grants: await tx.roleGrant.findMany({
        where: { schoolId, role: { in: [...STAFF_ROLES] } },
        select: { id: true, userId: true, role: true, branchId: true, grantedAt: true, grantedById: true, revokedAt: true, pausedAt: true },
        orderBy: { grantedAt: 'desc' },
      }),
      main: await mainOwnerGrant(tx, schoolId),
      branches: await tx.branch.findMany({ where: { schoolId }, select: { id: true, name: true } }),
      permissions: await tx.staffPermission.findMany({
        where: { schoolId },
        select: { userId: true, displayName: true, workPhone: true, ...STAFF_ACCESS_SELECT },
      }),
    }));

    const userIds = [...new Set(grants.map((g) => g.userId))];
    const granterIds = [...new Set(grants.map((g) => g.grantedById).filter((id): id is string => !!id))];
    const users = await this.prismaAuth.user.findMany({
      where: { id: { in: [...new Set([...userIds, ...granterIds])] } },
      select: { id: true, firstName: true, surname: true, email: true, phone: true, profilePhotoUrl: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const permissionOf = new Map(permissions.map((p) => [p.userId, p]));

    const status = query.status ?? 'active';
    const q = query.q?.toLowerCase();
    const items: StaffMemberDto[] = [];
    for (const userId of userIds) {
      const user = userById.get(userId);
      if (!user) continue; // account deleted since
      const own = grants.filter((g) => g.userId === userId);
      const active = own.some((g) => !g.revokedAt);
      // Decision 390: paused staff are still staff, listed with the active
      // ones (and on their own under "paused"), never under "removed".
      const paused = !active && own.some((g) => g.pausedAt);
      if (status === 'active' && !active && !paused) continue;
      if (status === 'paused' && !paused) continue;
      if (status === 'removed' && (active || paused)) continue;
      // The role and branch filters look at the roles this view is about:
      // current ones for active staff, paused ones for paused staff, ended
      // ones for removed staff.
      const relevant = own.filter((g) => (status === 'all' ? true : active ? !g.revokedAt : paused ? !!g.pausedAt : true));
      if (query.role && !relevant.some((g) => g.role === query.role)) continue;
      if (query.branchId && !relevant.some((g) => g.branchId === query.branchId)) continue;
      const permission = permissionOf.get(userId);
      if (q && ![`${user.firstName} ${user.surname}`, user.email, permission?.displayName ?? ''].some((v) => v.toLowerCase().includes(q))) continue;

      const roles = [...own].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || b.grantedAt.getTime() - a.grantedAt.getTime());
      const granter = (id: string | null) => {
        const u = id ? userById.get(id) : undefined;
        return u ? `${u.firstName} ${u.surname}`.trim() : null;
      };
      items.push({
        userId,
        firstName: user.firstName,
        surname: user.surname,
        email: user.email,
        phone: user.phone,
        profilePhotoUrl: user.profilePhotoUrl,
        active,
        addedAt: new Date(Math.min(...own.map((g) => g.grantedAt.getTime()))).toISOString(),
        removedAt: active || paused ? null : new Date(Math.max(...own.map((g) => g.revokedAt!.getTime()))).toISOString(),
        paused,
        pausedAt: paused ? new Date(Math.max(...own.filter((g) => g.pausedAt).map((g) => g.pausedAt!.getTime()))).toISOString() : null,
        canInviteCoaches: permission?.canInviteCoaches ?? false,
        canManageDisciplines: permission?.canManageDisciplines ?? false,
        mainOwner: main?.userId === userId,
        displayName: permission?.displayName ?? null,
        workPhone: permission?.workPhone ?? null,
        access: own.some((g) => g.role === 'BRANCH_STAFF' && (!g.revokedAt || g.pausedAt)) ? staffAccessFrom(permission) : null,
        roles: roles.map((g) => ({
          grantId: g.id,
          role: g.role as StaffRole,
          branchId: g.branchId,
          branchName: g.branchId ? branchName.get(g.branchId) ?? null : null,
          grantedAt: g.grantedAt.toISOString(),
          grantedByName: granter(g.grantedById),
          revokedAt: g.revokedAt?.toISOString() ?? null,
          pausedAt: g.pausedAt?.toISOString() ?? null,
        })),
      });
    }
    items.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Number(b.paused) - Number(a.paused) ||
        `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`, undefined, { sensitivity: 'base' }),
    );
    return { items };
  }

  /**
   * Decision 387 — GET /schools/{schoolId}/staff for Branch Staff whose owner
   * switched on "See the staff list": read only, current staff only, and only
   * the people and roles at their own branches, plus the School's owners and
   * School-wide roles. A Branch Staff role with no branch covers the whole
   * School. Grants, branches and the School's display names are read through
   * ultm8_jobs once the switch is checked: RoleGrant RLS shows Branch Staff
   * only their own roles and their students'. No switches, no "who gave it".
   */
  private async listStaffForBranchStaff(callerId: string, schoolId: string, query: StaffListQueryDto) {
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'staffList');
    const mine = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({ where: { userId: callerId, schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { branchId: true } }),
    );
    const wholeSchool = mine.some((g) => g.branchId === null);
    const myBranches = new Set(mine.map((g) => g.branchId));
    const visible = (g: { role: string; branchId: string | null }) =>
      g.role === 'SCHOOL_OWNER_MANAGER' || g.branchId === null || wholeSchool || myBranches.has(g.branchId);

    // Read only, current staff only: nobody paused or removed (Decision 390).
    if (query.status === 'removed' || query.status === 'paused') return { items: [] };
    const [grants, branches, details] = await Promise.all([
      this.prismaJobs.roleGrant.findMany({
        where: { schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null },
        select: { id: true, userId: true, role: true, branchId: true, grantedAt: true, isMainOwner: true },
        orderBy: { grantedAt: 'desc' },
      }),
      this.prismaJobs.branch.findMany({ where: { schoolId }, select: { id: true, name: true } }),
      this.prismaJobs.staffPermission.findMany({ where: { schoolId }, select: { userId: true, displayName: true, workPhone: true } }),
    ]);
    const shown = grants.filter(visible);
    const userIds = [...new Set(shown.map((g) => g.userId))];
    const users = await this.prismaAuth.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, surname: true, email: true, phone: true, profilePhotoUrl: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const detailOf = new Map(details.map((d) => [d.userId, d]));
    const q = query.q?.toLowerCase();

    const items: StaffMemberDto[] = [];
    for (const userId of userIds) {
      const user = userById.get(userId);
      if (!user) continue;
      const own = shown.filter((g) => g.userId === userId);
      if (query.role && !own.some((g) => g.role === query.role)) continue;
      if (query.branchId && !own.some((g) => g.branchId === query.branchId)) continue;
      const detail = detailOf.get(userId);
      if (q && ![`${user.firstName} ${user.surname}`, user.email, detail?.displayName ?? ''].some((v) => v.toLowerCase().includes(q))) continue;
      items.push({
        userId,
        firstName: user.firstName,
        surname: user.surname,
        email: user.email,
        phone: user.phone,
        profilePhotoUrl: user.profilePhotoUrl,
        active: true,
        addedAt: new Date(Math.min(...grants.filter((g) => g.userId === userId).map((g) => g.grantedAt.getTime()))).toISOString(),
        removedAt: null,
        paused: false,
        pausedAt: null,
        canInviteCoaches: false,
        canManageDisciplines: false,
        mainOwner: own.some((g) => g.isMainOwner),
        displayName: detail?.displayName ?? null,
        workPhone: detail?.workPhone ?? null,
        access: null,
        roles: own.map((g) => ({
          grantId: g.id,
          role: g.role as StaffRole,
          branchId: g.branchId,
          branchName: g.branchId ? branchName.get(g.branchId) ?? null : null,
          grantedAt: g.grantedAt.toISOString(),
          grantedByName: null,
          revokedAt: null,
          pausedAt: null,
        })),
      });
    }
    items.sort((a, b) => `${a.firstName} ${a.surname}`.localeCompare(`${b.firstName} ${b.surname}`, undefined, { sensitivity: 'base' }));
    return { items };
  }

  /**
   * PUT /schools/{schoolId}/staff/{userId}/access (Decision 387) — the owner
   * sets a Branch Staff member's six access switches, all at once (the
   * portal's presets are just ticks). Only for someone who holds a Branch
   * Staff role here now, or one that is paused (Decision 390: the switches
   * apply again when they are unpaused); Instructors' rights come from their role (Spec 55
   * §8.2) and owners have every right. Turning "Invite coaches" off cancels
   * the coach invites they still have open, as before (Decision 183). Their
   * next request sees the change: every check reads the switches fresh.
   */
  async setStaffAccess(callerId: string, schoolId: string, userId: string, dto: StaffAccessDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const access: StaffAccessSet = Object.fromEntries(STAFF_ACCESS.map((k) => [k, dto[k]])) as StaffAccessSet;
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const isStaff = await tx.roleGrant.findFirst({ where: { userId, schoolId, role: 'BRANCH_STAFF', ...LIVE_OR_PAUSED }, select: { id: true } });
      if (!isStaff) {
        throw new BadRequestException('Access switches are for Branch Staff. Coaches have the rights of their role, and owners have every right.');
      }
      const columns = toPermissionColumns(access);
      await tx.staffPermission.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, ...columns, grantedById: callerId },
        update: { ...columns, grantedById: callerId },
      });
    });
    if (!access.inviteCoaches) await this.coachInvites.cancelOpenInvitesFrom(callerId, schoolId, userId);
    return { userId, access };
  }

  /** GET /schools/{schoolId}/staff/me/access (Decision 387) — what the caller
   * may do at this School, so the portal shows only the pages they can use. */
  async myStaffAccess(callerId: string, schoolId: string) {
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({ where: { userId: callerId, schoolId, role: { in: [...STAFF_ROLES] }, revokedAt: null }, select: { role: true } }),
    );
    if (grants.length === 0) throw new ForbiddenException('You are not on the staff of this School.');
    const owner = grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER');
    const branchStaff = grants.some((g) => g.role === 'BRANCH_STAFF');
    if (owner) {
      return { owner, branchStaff, access: Object.fromEntries(STAFF_ACCESS.map((k) => [k, true])) as StaffAccessSet };
    }
    let access: StaffAccessSet = Object.fromEntries(STAFF_ACCESS.map((k) => [k, false])) as StaffAccessSet;
    if (branchStaff) {
      const row = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } }, select: STAFF_ACCESS_SELECT }),
      );
      access = staffAccessFrom(row);
    }
    if (grants.some((g) => g.role === 'INSTRUCTOR')) access = { ...access, bookings: true, students: true };
    return { owner, branchStaff, access };
  }

  /**
   * PATCH /schools/{schoolId}/staff/{userId}/details (Decision 381) — an owner
   * sets the School's own display name and work phone for someone on its
   * staff. Kept on the School's StaffPermission row, never on the person's
   * account: their real name, login email and personal phone stay theirs. A
   * field left out is unchanged; null clears it. Only for people who hold a
   * staff, coach or owner role here now, or are paused (Decision 390).
   */
  async updateStaffDetails(callerId: string, schoolId: string, userId: string, dto: UpdateStaffDetailsDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const data: { displayName?: string | null; workPhone?: string | null } = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.workPhone !== undefined) data.workPhone = dto.workPhone;

    const saved = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const isStaff = await tx.roleGrant.findFirst({
        where: { userId, schoolId, role: { in: [...STAFF_ROLES] }, ...LIVE_OR_PAUSED },
        select: { id: true },
      });
      if (!isStaff) {
        throw new NotFoundException('This person is not on the staff of this School.');
      }
      return tx.staffPermission.upsert({
        where: { schoolId_userId: { schoolId, userId } },
        create: { id: randomUUID(), schoolId, userId, ...data },
        update: data,
        select: { userId: true, displayName: true, workPhone: true },
      });
    });
    return saved;
  }

  /**
   * POST /schools/{schoolId}/staff/{userId}/remove (Decision 361) — "Remove
   * from School": ends every coach and Branch Staff role the person holds
   * here, at every branch, in one step, with the same clean-up as revoke()
   * (grading permissions, "Can invite coaches", their open coach invites).
   * Their account stays, and so does any student role they hold here. Owner
   * roles are not touched: removing an owner is its own, separate rule (main
   * owner and co-owners). Their access ends on their next request.
   *
   * `alsoInTx` runs inside the same transaction once the roles are ended (not
   * at all when there were none): StaffRemovalService uses it to hand over or
   * clear the person's classes in the same step (Decision 361 follow-up).
   *
   * Someone paused (Decision 390) can be removed too: their paused roles stop
   * being paused, so Unpause no longer gives them back.
   */
  async removeFromSchool<T = undefined>(
    callerId: string,
    schoolId: string,
    userId: string,
    alsoInTx?: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ removedRoles: number; also?: T }> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const result = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const live = await tx.roleGrant.updateMany({
        where: { userId, schoolId, revokedAt: null, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] } },
        data: { revokedAt: new Date() },
      });
      const paused = await tx.roleGrant.updateMany({
        where: { userId, schoolId, pausedAt: { not: null }, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] } },
        data: { pausedAt: null, pausedById: null },
      });
      const count = live.count + paused.count;
      if (count === 0) return { removedRoles: 0 };
      await this.clearCoachRightsIfGone(tx, userId, schoolId);
      return { removedRoles: count, also: alsoInTx ? await alsoInTx(tx) : undefined };
    });
    if (result.removedRoles === 0) {
      throw new NotFoundException('This person holds no coach or Branch Staff role at this School.');
    }
    await this.coachInvites.cancelOpenInvitesFrom(callerId, schoolId, userId);
    this.rolesChanged.forget(userId);
    return result;
  }

  /**
   * POST /schools/{schoolId}/staff/{userId}/pause (Decision 390) — "Pause":
   * switches off all of someone's staff access here for a while (a holiday,
   * an investigation) without losing what the School set up for them.
   *
   * Each of their coach and Branch Staff roles here is ended the ordinary way
   * (revokedAt), so every access check, RLS helper and job already treats it
   * as gone, and is marked paused. Nothing else changes: their access
   * switches, grading permissions, display name, coach profile and the
   * classes they teach all stay as they are. Their access ends on their next
   * request (Decision 361). Owners are not paused: an owner has every right,
   * and removing one is its own rule (Decision 370).
   */
  async pauseStaff(callerId: string, schoolId: string, userId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const pausedAt = new Date();
    const pausedRoles = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const owner = await tx.roleGrant.findFirst({ where: { userId, schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { id: true } });
      if (owner) {
        throw new BadRequestException("Owners can't be paused. Pause is for coaches and Branch Staff.");
      }
      const { count } = await tx.roleGrant.updateMany({
        where: { userId, schoolId, revokedAt: null, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] } },
        data: { revokedAt: pausedAt, pausedAt, pausedById: callerId },
      });
      if (count === 0) {
        const already = await tx.roleGrant.findFirst({ where: { userId, schoolId, pausedAt: { not: null } }, select: { id: true } });
        if (already) throw new ConflictException('This person is already paused.');
        throw new NotFoundException('This person holds no coach or Branch Staff role at this School.');
      }
      return count;
    });
    this.rolesChanged.forget(userId);
    return { userId, pausedRoles, pausedAt: pausedAt.toISOString() };
  }

  /**
   * POST /schools/{schoolId}/staff/{userId}/unpause (Decision 390) — gives
   * back the roles Pause ended: the same rows, at the same branches, with
   * everything the School set for them. A role at a branch that was closed
   * meanwhile stays ended (nobody joins a closed branch, Decision 296); its
   * branch is named in the answer so the owner can give a role elsewhere.
   */
  async unpauseStaff(callerId: string, schoolId: string, userId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const result = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const paused = await tx.roleGrant.findMany({
        where: { userId, schoolId, pausedAt: { not: null } },
        select: { id: true, role: true, branchId: true, branch: { select: { name: true, archivedAt: true } } },
      });
      if (paused.length === 0) throw new NotFoundException('This person is not paused.');
      // A role they were given again meanwhile, at the same branch, already
      // covers that one (RoleGrant_one_live_per_scope allows only one).
      const live = await tx.roleGrant.findMany({ where: { userId, schoolId, revokedAt: null }, select: { role: true, branchId: true } });
      const held = (g: { role: string; branchId: string | null }) => live.some((l) => l.role === g.role && l.branchId === g.branchId);
      const closed = paused.filter((g) => g.branch?.archivedAt);
      const back = paused.filter((g) => !g.branch?.archivedAt && !held(g));
      const done = paused.filter((g) => !back.includes(g));
      if (done.length > 0) {
        await tx.roleGrant.updateMany({ where: { id: { in: done.map((g) => g.id) } }, data: { pausedAt: null, pausedById: null } });
      }
      if (back.length > 0) {
        await tx.roleGrant.updateMany({ where: { id: { in: back.map((g) => g.id) } }, data: { revokedAt: null, pausedAt: null, pausedById: null } });
      }
      // Rights kept for the paused roles go if none of them came back.
      await this.clearCoachRightsIfGone(tx, userId, schoolId);
      return { restoredRoles: back.length, closedBranches: [...new Set(closed.map((g) => g.branch!.name))] };
    });
    this.rolesChanged.forget(userId);
    return { userId, ...result };
  }

  /** Decision 390 — refuses a new coach or Branch Staff role for someone who
   * is paused here: Unpause gives their roles back. */
  async assertNotPaused(callerId: string, schoolId: string, userId: string) {
    const paused = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId, schoolId, pausedAt: { not: null } }, select: { id: true } }),
    );
    if (paused) {
      throw new ConflictException({ code: 'STAFF_PAUSED', message: 'This person is paused at this School. Unpause them to give their roles back.' });
    }
  }

  /**
   * POST /schools/{schoolId}/main-owner (Decision 370) — the main owner hands
   * the main role to one of the School's co-owners, after re-entering their
   * passcode (the X-Step-Up-Token from POST /auth/step-up/verify). They stay
   * an owner, now a co-owner.
   */
  async handOverMainOwner(callerId: string, schoolId: string, targetUserId: string, stepUpToken: string | undefined) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    this.stepUp.assertVerified(callerId, stepUpToken);

    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const main = await mainOwnerGrant(tx, schoolId);
      if (main?.userId !== callerId) {
        throw new ForbiddenException({ code: 'NOT_MAIN_OWNER', message: 'Only the main owner can hand over the main owner role.' });
      }
      if (targetUserId === callerId) {
        throw new BadRequestException('You are already the main owner.');
      }
      const target = await tx.roleGrant.findFirst({
        where: { schoolId, userId: targetUserId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
        orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!target) {
        throw new NotFoundException('This person is not a co-owner of this School.');
      }
      await tx.roleGrant.updateMany({ where: { schoolId, isMainOwner: true, revokedAt: null }, data: { isMainOwner: false } });
      await tx.roleGrant.update({ where: { id: target.id }, data: { isMainOwner: true } });
    });
    return { mainOwnerUserId: targetUserId };
  }

  /** Decision 331 — an Instructor role can't be taken away while it still
   * leaves upcoming Classes or active weekly Timetable slots at this School
   * with an instructor who no longer holds the role there. A row is still
   * covered when another active Instructor role of theirs covers its branch
   * (the same rule as TenantAuthorizationService.assertValidInstructor), so
   * removing one branch of several only blocks on that branch's rows. Same
   * "upcoming"/"active" test as archiving an Instructor profile, so "Hand
   * over classes" clears exactly what this counts. */
  private async assertNoClassesLeftWithoutInstructor(callerId: string, grantId: string, userId: string, schoolId: string): Promise<void> {
    const now = new Date();
    const [others, classes, slots] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.roleGrant.findMany({ where: { userId, schoolId, role: 'INSTRUCTOR', revokedAt: null, id: { not: grantId } }, select: { branchId: true } }),
        tx.class.findMany({ where: { schoolId, instructorId: userId, endDate: { gte: now }, archivedAt: null }, select: { branchId: true } }),
        tx.timetableSlot.findMany({ where: { schoolId, instructorId: userId, status: 'ON', archivedAt: null }, select: { branchId: true } }),
      ]),
    );
    const covered = (branchId: string | null) => others.some((g) => g.branchId === null || branchId === null || g.branchId === branchId);
    if (classes.some((c) => !covered(c.branchId)) || slots.some((t) => !covered(t.branchId))) {
      throw new ConflictException(
        'They still teach upcoming classes or weekly timetable slots here. Use "Hand over classes" on their instructor page first, then remove the role.',
      );
    }
  }
}

/**
 * Decision 370 — a School's main owner: the live owner grant flagged
 * isMainOwner, or, where none is flagged (a School whose main owner's account
 * was deleted, or rows written before the flag existed), the earliest live
 * owner grant, the rule the product owner chose for existing Schools.
 */
export function mainOwnerGrant(tx: Prisma.TransactionClient, schoolId: string) {
  return tx.roleGrant.findFirst({
    where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
    orderBy: [{ isMainOwner: 'desc' }, { grantedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true },
  });
}

/** A StaffAccessSet as StaffPermission columns (Decision 387). */
function toPermissionColumns(access: StaffAccessSet) {
  return {
    canManageClasses: access.classes,
    canManageBookings: access.bookings,
    canManageStudents: access.students,
    canCancelClasses: access.cancelClasses,
    canSeeStaffList: access.staffList,
    canInviteCoaches: access.inviteCoaches,
    canManageDisciplines: access.disciplines,
    canManageCheckInRules: access.checkInRules,
  };
}
