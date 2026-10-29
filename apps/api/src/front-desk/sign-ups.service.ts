import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SignUp } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { isAdultOn } from '../common/decorators/is-birth-date.decorator';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { RoleGrantsService } from '../tenants/role-grants/role-grants.service';
import { MembershipsService } from '../memberships/memberships.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { FrontDeskSessionContext } from './front-desk-sessions.service';
import { ApproveSignUpDto, KioskSignUpDto, SignUpDto } from './dto/sign-up.dto';
import { heardFromList, REJECTED_SIGN_UP_DAYS } from './sign-up-rules';

const DAY_MS = 24 * 60 * 60 * 1000;

const UNDER_18 = { code: 'SIGN_UP_UNDER_18', message: "Under 18s are signed up by their Guardian in the ULTM8 app." };
const VISITORS_OFF = { code: 'VISITOR_PERIOD_NOT_SET', message: 'Set how long a visit pass lasts in School settings first.' };

type Coverage = { all: true } | { all: false; branchIds: Set<string> };

/**
 * Decision 392: sign-ups from the front-desk tablet (handover F5; Decisions
 * 351, 362, 365).
 *
 * - The tablet sends one; it waits for staff. Adults only: a child is signed
 *   up by their Guardian in the app. "Visitor" needs the School's visitor
 *   period (Decision 391).
 * - The owner, or Branch Staff with the students switch for the sign-up's
 *   Branch, approves or rejects it. Coaches don't.
 * - Approving a new email makes the account (temporary passcode emailed, as
 *   "Add manually") and enrols it at the tablet's Branch; a Visitor also gets
 *   a visit pass. An email that already has an account is sent an invite
 *   instead, which that account accepts or declines in the app.
 * - Rejecting sends a polite email with no reason. The sign-up is kept 30 days
 *   (the daily purge deletes it after), and staff can still approve it then.
 *
 * Sign-ups are read and written on the jobs connection only (no request
 * context may read the table), after the checks here.
 */
@Injectable()
export class SignUpsService {
  private readonly logger = new Logger(SignUpsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schools: SchoolsService,
    private readonly roleGrants: RoleGrantsService,
    private readonly memberships: MembershipsService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  // ---------------------------------------------------------------------------
  // The tablet
  // ---------------------------------------------------------------------------

  async submitFromKiosk(session: FrontDeskSessionContext, dto: KioskSignUpDto): Promise<{ id: string }> {
    if (!isAdultOn(new Date(dto.dateOfBirth))) {
      throw new BadRequestException(UNDER_18);
    }
    const school = await this.prismaJobs.school.findUniqueOrThrow({
      where: { id: session.schoolId },
      select: { visitorPeriodDays: true, heardFromOptions: true },
    });
    if (dto.kind === 'VISITOR' && !school.visitorPeriodDays) {
      throw new BadRequestException(VISITORS_OFF);
    }
    const options = heardFromList(school.heardFromOptions);
    if (dto.heardFrom && options && !options.includes(dto.heardFrom)) {
      throw new BadRequestException('Choose one of the listed answers to "How did you hear about us?".');
    }
    const email = dto.email.trim().toLowerCase();
    // One waiting sign-up per email at a School: a second tap of Send, or the
    // same person again before staff have looked.
    const waiting = await this.prismaJobs.signUp.findFirst({
      where: { schoolId: session.schoolId, email, status: { in: ['PENDING', 'INVITED'] } },
      select: { id: true },
    });
    if (waiting) {
      throw new ConflictException({ code: 'SIGN_UP_WAITING', message: 'This email has already signed up here. A member of staff will be in touch.' });
    }
    const created = await this.prismaJobs.signUp.create({
      data: {
        schoolId: session.schoolId,
        branchId: session.branchId,
        kind: dto.kind,
        firstName: dto.firstName,
        surname: dto.surname,
        dateOfBirth: new Date(dto.dateOfBirth),
        gender: dto.gender ?? null,
        email,
        phone: dto.phone ?? null,
        heardFrom: dto.heardFrom ?? null,
        emergencyName: dto.emergencyName ?? null,
        emergencyPhone: dto.emergencyPhone ?? null,
        emergencyRelationship: dto.emergencyRelationship ?? null,
      },
      select: { id: true },
    });
    return created;
  }

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------

  async list(callerId: string, schoolId: string, view: 'WAITING' | 'REJECTED' | 'DONE' = 'WAITING'): Promise<{ items: SignUpDto[] }> {
    const coverage = await this.coverage(callerId, schoolId);
    const status: Prisma.SignUpWhereInput['status'] =
      view === 'WAITING' ? { in: ['PENDING', 'INVITED'] } : view === 'REJECTED' ? 'REJECTED' : { in: ['APPROVED', 'DECLINED'] };
    const rows = await this.prismaJobs.signUp.findMany({
      where: { schoolId, status, ...(coverage.all ? {} : { branchId: { in: [...coverage.branchIds] } }) },
      orderBy: [{ createdAt: view === 'WAITING' ? 'asc' : 'desc' }, { id: 'asc' }],
      include: { branch: { select: { name: true } } },
      take: 500,
    });
    return { items: await this.present(rows) };
  }

  async approve(callerId: string, schoolId: string, id: string, dto: ApproveSignUpDto) {
    const signUp = await this.loadForStaff(callerId, schoolId, id);
    if (signUp.status !== 'PENDING' && signUp.status !== 'REJECTED') {
      throw new ConflictException('This sign-up has already been dealt with.');
    }
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, visitorPeriodDays: true } });
    const branchId = signUp.branchId ?? dto.branchId;
    const existing = await this.prismaAuth.user.findUnique({ where: { email: signUp.email }, select: { id: true } });

    if (existing) {
      const enrolled = await this.prismaJobs.roleGrant.findFirst({
        where: { userId: existing.id, schoolId, role: 'STUDENT', revokedAt: null },
        select: { id: true },
      });
      if (enrolled) {
        throw new ConflictException({ code: 'SIGN_UP_ALREADY_STUDENT', message: 'This email already belongs to a student of this School.' });
      }
      const claimed = await this.claim(signUp, { status: 'INVITED', userId: existing.id, approvedById: callerId, approvedAt: new Date(), branchId: branchId ?? null });
      const emailFailed = !(await this.sendEmail(
        signUp.email,
        `${school.name} would like to add you on ULTM8`,
        [
          `Thanks for signing up at ${school.name}.`,
          '',
          `This email already has a ULTM8 account. Open the ULTM8 app and sign in to accept, and you'll be added to ${school.name}.`,
        ].join('\n'),
      ));
      return { signUp: (await this.present([claimed]))[0], accountCreated: false, invited: true, visitPassGiven: false, emailFailed, temporaryPasscode: null };
    }

    // A new account. Claimed first, so two approvals at once make one account.
    const claimed = await this.claim(signUp, { status: 'APPROVED', approvedById: callerId, approvedAt: new Date(), branchId: branchId ?? null });
    let userId: string;
    let tempPasscode: string;
    try {
      ({ userId, tempPasscode } = await this.roleGrants.createStudentAccount({
        email: signUp.email,
        firstName: signUp.firstName,
        surname: signUp.surname,
        dateOfBirth: signUp.dateOfBirth,
        gender: signUp.gender,
      }));
      await this.roleGrants.enrolNewAccount(userId, () => this.schools.join(userId, schoolId, { branchId: branchId ?? undefined }, { notify: false }));
    } catch (err) {
      await this.unclaim(signUp);
      throw err;
    }
    const updated = await this.prismaJobs.signUp.update({ where: { id: claimed.id }, data: { userId }, include: { branch: { select: { name: true } } } });
    const visitPassGiven = await this.giveVisitPassIfVisitor(signUp, callerId, userId, school.visitorPeriodDays);
    const emailSent = await this.sendEmail(
      signUp.email,
      `Welcome to ${school.name} on ULTM8`,
      [
        `${school.name} has accepted your sign-up.`,
        '',
        `Sign in to the ULTM8 app with this email address (${signUp.email}) and the temporary passcode below. You'll be asked to choose your own passcode straight away.`,
        '',
        `Temporary passcode: ${tempPasscode}`,
      ].join('\n'),
    );
    return {
      signUp: (await this.present([updated]))[0],
      accountCreated: true,
      invited: false,
      visitPassGiven,
      emailFailed: !emailSent,
      // Email isn't always set up: the staff member then hands it over in person.
      temporaryPasscode: emailSent ? null : tempPasscode,
    };
  }

  async reject(callerId: string, schoolId: string, id: string) {
    const signUp = await this.loadForStaff(callerId, schoolId, id);
    if (signUp.status !== 'PENDING' && signUp.status !== 'INVITED') {
      throw new ConflictException('This sign-up has already been dealt with.');
    }
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } });
    // An invite withdrawn this way leaves the account as it was.
    const rejected = await this.claim(signUp, { status: 'REJECTED', rejectedById: callerId, rejectedAt: new Date(), userId: null });
    // Decision 362: polite, and no reason given.
    await this.sendEmail(
      signUp.email,
      `Your sign-up at ${school.name}`,
      [`Thank you for signing up at ${school.name}.`, '', `We weren't able to accept your sign-up this time. Please talk to the front desk on your next visit.`].join('\n'),
    );
    return (await this.present([rejected]))[0];
  }

  // ---------------------------------------------------------------------------
  // The invited account (student app)
  // ---------------------------------------------------------------------------

  async myInvites(callerId: string) {
    const rows = await this.prismaJobs.signUp.findMany({
      where: { userId: callerId, status: 'INVITED' },
      orderBy: { createdAt: 'asc' },
      include: { school: { select: { name: true, archivedAt: true } } },
    });
    const open = rows.filter((r) => !r.school.archivedAt);
    const branched = await this.prismaJobs.branch.groupBy({
      by: ['schoolId'],
      where: { schoolId: { in: open.map((r) => r.schoolId) }, archivedAt: null },
      _count: { _all: true },
    });
    const hasBranches = new Set(branched.map((b) => b.schoolId));
    return {
      items: open.map((r) => ({
        id: r.id,
        schoolId: r.schoolId,
        schoolName: r.school.name,
        kind: r.kind,
        branchId: r.branchId,
        needsBranch: !r.branchId && hasBranches.has(r.schoolId),
        createdAt: r.createdAt,
      })),
    };
  }

  async accept(callerId: string, id: string, branchId?: string) {
    const signUp = await this.loadInvite(callerId, id);
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: signUp.schoolId }, select: { visitorPeriodDays: true } });
    const claimed = await this.claim(signUp, { status: 'APPROVED', respondedAt: new Date(), branchId: signUp.branchId ?? branchId ?? null });
    let joined: { accessToken?: string };
    try {
      joined = (await this.schools.join(callerId, signUp.schoolId, { branchId: claimed.branchId ?? undefined })) as { accessToken?: string };
    } catch (err) {
      await this.unclaim(signUp);
      throw err;
    }
    const visitPassGiven = await this.giveVisitPassIfVisitor(signUp, signUp.approvedById ?? callerId, callerId, school.visitorPeriodDays);
    return { schoolId: signUp.schoolId, visitPassGiven, accessToken: joined.accessToken };
  }

  async decline(callerId: string, id: string) {
    const signUp = await this.loadInvite(callerId, id);
    await this.claim(signUp, { status: 'DECLINED', respondedAt: new Date() });
  }

  // ---------------------------------------------------------------------------

  /** The owner sees every sign-up; Branch Staff with the students switch see
   * their Branches' (all of them with a School-wide grant). Coaches none. */
  private async coverage(callerId: string, schoolId: string): Promise<Coverage> {
    await this.schools.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    if (await this.tenantAuth.isSchoolOwner(callerId, schoolId)) return { all: true };
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({ where: { userId: callerId, schoolId, role: 'BRANCH_STAFF', revokedAt: null }, select: { branchId: true } }),
    );
    if (grants.length === 0) throw new ForbiddenException('Only the owner or Branch Staff can see sign-ups.');
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'students');
    if (grants.some((g) => g.branchId === null)) return { all: true };
    return { all: false, branchIds: new Set(grants.map((g) => g.branchId as string)) };
  }

  private async loadForStaff(callerId: string, schoolId: string, id: string) {
    const coverage = await this.coverage(callerId, schoolId);
    const signUp = await this.prismaJobs.signUp.findFirst({ where: { id, schoolId }, include: { branch: { select: { name: true } } } });
    if (!signUp || (!coverage.all && !(signUp.branchId && coverage.branchIds.has(signUp.branchId)))) {
      throw new NotFoundException('Sign-up not found');
    }
    return signUp;
  }

  private async loadInvite(callerId: string, id: string) {
    const signUp = await this.prismaJobs.signUp.findFirst({ where: { id, userId: callerId, status: 'INVITED' }, include: { branch: { select: { name: true } } } });
    if (!signUp) throw new NotFoundException('Invite not found');
    return signUp;
  }

  /** Moves a sign-up on from the status it was read in, or 409 if someone
   * else got there first (two staff at once, or a double tap). */
  private async claim(signUp: SignUp, data: Prisma.SignUpUncheckedUpdateInput) {
    const result = await this.prismaJobs.signUp.updateMany({ where: { id: signUp.id, status: signUp.status }, data });
    if (result.count !== 1) {
      throw new ConflictException('This sign-up has already been dealt with.');
    }
    return this.prismaJobs.signUp.findUniqueOrThrow({ where: { id: signUp.id }, include: { branch: { select: { name: true } } } });
  }

  /** Puts a sign-up back as it was when the work after its claim failed. */
  private async unclaim(signUp: SignUp) {
    await this.prismaJobs.signUp
      .update({
        where: { id: signUp.id },
        data: {
          status: signUp.status,
          userId: signUp.userId,
          branchId: signUp.branchId,
          approvedById: signUp.approvedById,
          approvedAt: signUp.approvedAt,
          rejectedById: signUp.rejectedById,
          rejectedAt: signUp.rejectedAt,
          respondedAt: signUp.respondedAt,
        },
      })
      .catch((err) => this.logger.error(`Sign-up ${signUp.id}: could not be put back after a failed approval — ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Decision 391: a Visitor gets a visit pass on joining, when the School
   * has a visitor period. A failure here leaves them enrolled without one;
   * staff can give it from their page. */
  private async giveVisitPassIfVisitor(signUp: SignUp, givenById: string, studentId: string, days: number | null): Promise<boolean> {
    if (signUp.kind !== 'VISITOR' || !days) return false;
    try {
      await this.memberships.grantVisitPass(givenById, signUp.schoolId, studentId, days);
      return true;
    } catch (err) {
      this.logger.warn(`Sign-up ${signUp.id}: joined, but the visit pass could not be given — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
    try {
      await this.delivery.sendEmail(to, subject, body);
      return true;
    } catch (err) {
      this.logger.warn(`A sign-up email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async present(rows: Array<SignUp & { branch: { name: string } | null }>): Promise<SignUpDto[]> {
    const deciders = rows.flatMap((r) => [r.approvedById, r.rejectedById]).filter((x): x is string => !!x);
    const names = await resolveUserNames(this.prismaAuth, deciders);
    const nameOf = (id: string | null) => {
      const n = id ? names.get(id) : undefined;
      return n ? `${n.firstName} ${n.surname}`.trim() : null;
    };
    const emails = rows.filter((r) => r.status === 'PENDING' || r.status === 'REJECTED').map((r) => r.email);
    const accounts = emails.length ? await this.prismaAuth.user.findMany({ where: { email: { in: emails } }, select: { email: true } }) : [];
    const withAccount = new Set(accounts.map((a) => a.email));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      firstName: r.firstName,
      surname: r.surname,
      dateOfBirth: r.dateOfBirth,
      gender: r.gender,
      email: r.email,
      phone: r.phone,
      heardFrom: r.heardFrom,
      emergencyName: r.emergencyName,
      emergencyPhone: r.emergencyPhone,
      emergencyRelationship: r.emergencyRelationship,
      branchId: r.branchId,
      branchName: r.branch?.name ?? null,
      hasAccount: r.userId !== null || withAccount.has(r.email),
      userId: r.userId,
      approvedByName: nameOf(r.approvedById),
      approvedAt: r.approvedAt,
      rejectedByName: nameOf(r.rejectedById),
      rejectedAt: r.rejectedAt,
      deletesAt: r.status === 'REJECTED' && r.rejectedAt ? new Date(r.rejectedAt.getTime() + REJECTED_SIGN_UP_DAYS * DAY_MS) : null,
      respondedAt: r.respondedAt,
      createdAt: r.createdAt,
    }));
  }
}
