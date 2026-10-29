import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChildInvite } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isAdultOn } from '../common/decorators/is-birth-date.decorator';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { newTemporaryPasscode, RoleGrantsService } from '../tenants/role-grants/role-grants.service';
import { GuardiansService } from '../guardians/guardians.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { AddChildManuallyDto } from './dto/student-access.dto';

const NO_TEMPORARY_PASSCODE = "Only an account your School made, that hasn't been signed in to yet, can get a new temporary passcode.";

const sameDay = (a: Date | string | null, b: Date | string) => !!a && new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Decision 403 (backlog 3.3): how the owner gives a new student app access.
 *
 * - An adult added by hand gets a temporary passcode (RoleGrantsService.
 *   createStudentManually, Decision 371); this service makes a new one when
 *   the first was never used.
 * - A child has no login of their own (Decision 175), so the owner names the
 *   child's Guardian. A new Guardian gets an account with the temporary
 *   passcode and the child is enrolled at once. A Guardian who already has an
 *   account gets an invite to accept in the app (ChildInvite), which adds the
 *   child to their account, or uses the same child already on it, and enrols
 *   them.
 *
 * Owner only, like Add manually. ChildInvite is read and written on the jobs
 * connection after these checks.
 */
@Injectable()
export class StudentAccessService {
  private readonly logger = new Logger(StudentAccessService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schools: SchoolsService,
    private readonly roleGrants: RoleGrantsService,
    private readonly guardians: GuardiansService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  // ---------------------------------------------------------------------------
  // A child, added by the owner
  // ---------------------------------------------------------------------------

  async addChildManually(callerId: string, schoolId: string, dto: AddChildManuallyDto) {
    const school = await this.schools.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (isAdultOn(new Date(dto.child.dateOfBirth))) {
      throw new BadRequestException('This is for children (under 18). Add an adult with their own email instead.');
    }
    await this.roleGrants.assertHomeBranchChoice(callerId, schoolId, dto.branchId);

    const email = dto.guardian.email.trim().toLowerCase();
    const childName = `${dto.child.firstName} ${dto.child.surname}`.trim();
    const existing = await this.prismaAuth.user.findUnique({ where: { email }, select: { id: true, dateOfBirth: true } });

    if (existing) {
      if (existing.dateOfBirth && !isAdultOn(existing.dateOfBirth)) {
        throw new BadRequestException('A Guardian must be 18 or over.');
      }
      const open = await this.prismaJobs.childInvite.findMany({ where: { guardianId: existing.id, schoolId, status: 'PENDING' } });
      if (open.some((i) => sameName(i.childFirstName, dto.child.firstName) && sameName(i.childSurname, dto.child.surname) && sameDay(i.childDateOfBirth, dto.child.dateOfBirth))) {
        throw new ConflictException('This Guardian already has an invite for this child. Wait for them to answer it in the app.');
      }
      const invite = await this.prismaJobs.childInvite.create({
        data: {
          schoolId,
          branchId: dto.branchId ?? null,
          guardianId: existing.id,
          childFirstName: dto.child.firstName,
          childSurname: dto.child.surname,
          childDateOfBirth: new Date(dto.child.dateOfBirth),
          childGender: dto.child.gender ?? null,
          createdById: callerId,
        },
      });
      const emailSent = await this.sendEmail(
        email,
        `${school.name} would like to add ${childName} on ULTM8`,
        [
          `${school.name} would like to add ${childName} as a student.`,
          '',
          `Open the ULTM8 app and sign in with this email address (${email}) to accept. ${childName} will be added to your account and enrolled at ${school.name}.`,
        ].join('\n'),
      );
      return { outcome: 'GUARDIAN_INVITED' as const, guardianEmail: email, emailSent, studentId: null, inviteId: invite.id, temporaryPasscode: null, temporaryPasscodeExpiresAt: null };
    }

    // A new Guardian: their account, then the child on it, then the child's
    // enrolment. If a later step fails, what was made is removed again.
    const { userId: guardianId, tempPasscode, expiresAt } = await this.roleGrants.createStudentAccount({
      email,
      firstName: dto.guardian.firstName,
      surname: dto.guardian.surname,
      schoolId,
    });
    let studentId: string | null = null;
    try {
      ({ studentId } = await this.guardians.createMinor(guardianId, {
        firstName: dto.child.firstName,
        surname: dto.child.surname,
        dateOfBirth: dto.child.dateOfBirth,
        gender: dto.child.gender ?? null,
      }));
      await this.schools.join(callerId, schoolId, { studentId, branchId: dto.branchId }, { notify: false });
    } catch (err) {
      await this.removeNewAccounts(guardianId, studentId);
      throw err;
    }

    const emailSent = await this.sendEmail(
      email,
      `${childName} has been added to ${school.name} on ULTM8`,
      [
        `${school.name} has added ${childName} as a student, with you as their Guardian.`,
        '',
        `Sign in to the ULTM8 app with this email address (${email}) and the temporary passcode below. You'll be asked to choose your own passcode straight away. The temporary passcode stops working after 7 days.`,
        '',
        `Temporary passcode: ${tempPasscode}`,
      ].join('\n'),
    );
    return {
      outcome: 'GUARDIAN_CREATED' as const,
      guardianEmail: email,
      emailSent,
      studentId,
      inviteId: null,
      temporaryPasscode: tempPasscode,
      temporaryPasscodeExpiresAt: expiresAt.toISOString(),
    };
  }

  /** The School's invites still waiting for the Guardian. Owner only. */
  async listChildInvites(callerId: string, schoolId: string) {
    await this.schools.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const rows = await this.prismaJobs.childInvite.findMany({
      where: { schoolId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { school: { select: { name: true } } },
    });
    const guardians = await this.prismaAuth.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.guardianId))] } },
      select: { id: true, firstName: true, surname: true, email: true },
    });
    const byId = new Map(guardians.map((g) => [g.id, g]));
    return {
      items: rows.map((r) => {
        const g = byId.get(r.guardianId);
        return { ...this.present(r), guardianName: g ? `${g.firstName} ${g.surname}`.trim() : null, guardianEmail: g?.email ?? null };
      }),
    };
  }

  async withdrawChildInvite(callerId: string, schoolId: string, id: string) {
    await this.schools.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const invite = await this.prismaJobs.childInvite.findFirst({ where: { id, schoolId } });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.claim(invite, { status: 'WITHDRAWN', respondedAt: new Date() });
  }

  // ---------------------------------------------------------------------------
  // The Guardian (student app)
  // ---------------------------------------------------------------------------

  async myChildInvites(callerId: string) {
    const rows = await this.prismaJobs.childInvite.findMany({
      where: { guardianId: callerId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { school: { select: { name: true, archivedAt: true } } },
    });
    return { items: rows.filter((r) => !r.school.archivedAt).map((r) => ({ ...this.present(r), guardianName: null, guardianEmail: null })) };
  }

  /** Adds the child to the Guardian's account, or uses the same child (same
   * name and date of birth) already on it, and enrols them at the School. */
  async acceptChildInvite(callerId: string, id: string) {
    const invite = await this.loadMyInvite(callerId, id);
    await this.claim(invite, { status: 'ACCEPTED', respondedAt: new Date() });

    let createdStudentId: string | null = null;
    try {
      const { items: minors } = await this.guardians.findMyMinors(callerId);
      const same = minors.find(
        (m) => sameName(m.firstName, invite.childFirstName) && sameName(m.surname, invite.childSurname) && sameDay(m.dateOfBirth, invite.childDateOfBirth),
      );
      let studentId = same?.studentId;
      if (!studentId) {
        ({ studentId } = await this.guardians.createMinor(callerId, {
          firstName: invite.childFirstName,
          surname: invite.childSurname,
          dateOfBirth: invite.childDateOfBirth.toISOString().slice(0, 10),
          gender: (invite.childGender as 'FEMALE' | 'MALE' | null) ?? null,
        }));
        createdStudentId = studentId;
      }
      const enrolled = await this.prismaJobs.roleGrant.findFirst({
        where: { userId: studentId, schoolId: invite.schoolId, role: 'STUDENT', revokedAt: null },
        select: { id: true },
      });
      if (!enrolled) {
        await this.schools.join(callerId, invite.schoolId, { studentId, branchId: invite.branchId ?? undefined });
      }
      await this.prismaJobs.childInvite.update({ where: { id: invite.id }, data: { studentId } });
      return { schoolId: invite.schoolId, studentId };
    } catch (err) {
      await this.prismaJobs.childInvite
        .update({ where: { id: invite.id }, data: { status: 'PENDING', respondedAt: null } })
        .catch((e) => this.logger.error(`Child invite ${invite.id}: could not be put back after a failed accept — ${e instanceof Error ? e.message : String(e)}`));
      if (createdStudentId) await this.removeNewAccounts(null, createdStudentId, callerId);
      throw err;
    }
  }

  async declineChildInvite(callerId: string, id: string) {
    const invite = await this.loadMyInvite(callerId, id);
    await this.claim(invite, { status: 'DECLINED', respondedAt: new Date() });
  }

  // ---------------------------------------------------------------------------
  // A new temporary passcode
  // ---------------------------------------------------------------------------

  async temporaryPasscodeStatus(callerId: string, schoolId: string, studentId: string) {
    const target = await this.passcodeTarget(callerId, schoolId, studentId);
    if (!target) return { available: false, forGuardian: false, accountName: null, expiresAt: null, expired: false };
    const expiresAt = target.temporaryPasscodeExpiresAt;
    return {
      available: true,
      forGuardian: target.id !== studentId,
      accountName: `${target.firstName} ${target.surname}`.trim(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      expired: !!expiresAt && expiresAt.getTime() <= Date.now(),
    };
  }

  /** Replaces an unused temporary passcode with a new one, for another 7
   * days. Shown to the owner once. */
  async newTemporaryPasscode(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const target = await this.passcodeTarget(callerId, schoolId, studentId);
    if (!target) throw new ConflictException(NO_TEMPORARY_PASSCODE);
    const { tempPasscode, passcodeHash, expiresAt } = await newTemporaryPasscode();
    // Only while still unused and still this School's: read and written in
    // one statement, so a sign-in in between wins.
    const { count } = await this.prismaApp.withTenantContext(target.id, (tx) =>
      tx.user.updateMany({
        where: { id: target.id, mustChangePasscode: true, temporaryPasscodeSchoolId: schoolId },
        data: { passcodeHash, temporaryPasscodeExpiresAt: expiresAt },
      }),
    );
    if (count !== 1) throw new ConflictException(NO_TEMPORARY_PASSCODE);
    return {
      temporaryPasscode: tempPasscode,
      expiresAt: expiresAt.toISOString(),
      forGuardian: target.id !== studentId,
      accountName: `${target.firstName} ${target.surname}`.trim(),
      email: target.email,
    };
  }

  /** The account whose temporary passcode the owner may replace: the
   * student's own, or for a child an active Guardian's. Only an account this
   * School made and nobody has signed in to yet, so another School's account
   * can never be taken over this way. Null when there is none. */
  private async passcodeTarget(callerId: string, schoolId: string, studentId: string) {
    await this.schools.findOne(callerId, schoolId);
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const enrolled = await this.prismaJobs.roleGrant.findFirst({
      where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    if (!enrolled) throw new NotFoundException('Student not found');
    const links = await this.prismaJobs.guardianLink.findMany({ where: { studentId, revokedAt: null }, select: { guardianId: true } });
    const candidates = await this.prismaAuth.user.findMany({
      where: { id: { in: [studentId, ...links.map((l) => l.guardianId)] }, mustChangePasscode: true, temporaryPasscodeSchoolId: schoolId },
      select: { id: true, firstName: true, surname: true, email: true, temporaryPasscodeExpiresAt: true },
    });
    return candidates.find((c) => c.id === studentId) ?? candidates[0] ?? null;
  }

  // ---------------------------------------------------------------------------

  private present(r: ChildInvite & { school: { name: string } }) {
    return {
      id: r.id,
      schoolId: r.schoolId,
      schoolName: r.school.name,
      childFirstName: r.childFirstName,
      childSurname: r.childSurname,
      childDateOfBirth: r.childDateOfBirth.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async loadMyInvite(callerId: string, id: string) {
    const invite = await this.prismaJobs.childInvite.findFirst({ where: { id, guardianId: callerId, status: 'PENDING' } });
    if (!invite) throw new NotFoundException('Invite not found');
    return invite;
  }

  /** Moves an invite on from PENDING, or 409 if it was already answered or
   * withdrawn (two taps, or the owner and the Guardian at once). */
  private async claim(invite: ChildInvite, data: { status: 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN'; respondedAt: Date }) {
    const { count } = await this.prismaJobs.childInvite.updateMany({ where: { id: invite.id, status: 'PENDING' }, data });
    if (count !== 1) throw new ConflictException('This invite has already been answered or withdrawn.');
  }

  /** Removes a child (and their link) and a new Guardian made in a step that
   * then failed, only while they hold no enrolment or role at all. */
  private async removeNewAccounts(guardianId: string | null, studentId: string | null, linkOwnerId: string | null = guardianId) {
    const log = (what: string) => (err: unknown) => this.logger.error(`${what} could not be removed after a failed add — ${err instanceof Error ? err.message : String(err)}`);
    if (studentId && linkOwnerId) {
      await this.prismaApp
        .withTenantContext(linkOwnerId, (tx) => tx.guardianLink.deleteMany({ where: { guardianId: linkOwnerId, studentId } }))
        .catch(log(`Child ${studentId}'s Guardian link`));
      await this.prismaApp
        .withTenantContext(studentId, (tx) => tx.user.deleteMany({ where: { id: studentId, roleGrants: { none: {} } } }))
        .catch(log(`Child ${studentId}`));
    }
    if (guardianId) {
      await this.prismaApp
        .withTenantContext(guardianId, (tx) => tx.user.deleteMany({ where: { id: guardianId, roleGrants: { none: {} }, guardianLinksAsGuardian: { none: {} } } }))
        .catch(log(`Guardian ${guardianId}`));
    }
  }

  private async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
    try {
      await this.delivery.sendEmail(to, subject, body);
      return true;
    } catch (err) {
      this.logger.warn(`An app-access email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
