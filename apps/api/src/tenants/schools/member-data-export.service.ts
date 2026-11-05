import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';

/** The StudentExportLog filter a one-member data export is logged under. */
export const MEMBER_DATA_EXPORT_FILTER = 'MEMBER_DATA';

/**
 * Decision 432 item 10 (stress test round 5, PRIV-10): "Download this
 * member's data". The School's owner gets, as one JSON file, what this School
 * holds about one person who is or was its student: their profile, enrolment,
 * join date and home Branch, tags, custom fields and statuses, Guardians,
 * staff notes, medical information, bookings, memberships, payments, waiver
 * signatures and belts. Only what this School holds: nothing from another
 * School they belong to. Owner-only, like the member's medical information
 * and notes it carries, and logged like a student-list export, under
 * StudentExportLog with the member's id.
 *
 * Read on the jobs connection (and their account on the auth one, as the
 * student-list export reads it), for this School and this person only: the
 * caller has been checked as the School's owner, and RLS can't show a former
 * student's rows. Erasing the data (Decisions 245/268) is not part of this.
 */
@Injectable()
export class MemberDataExportService {
  constructor(
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaAuth: PrismaAuthService,
  ) {}

  async export(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const db = this.prismaJobs;
    // Anyone who ever held a student role here, ended or not.
    const enrolment = await db.roleGrant.findMany({
      where: { userId: studentId, schoolId, role: 'STUDENT' },
      orderBy: { grantedAt: 'asc' },
      select: { grantedAt: true, revokedAt: true, branch: { select: { name: true } } },
    });
    if (enrolment.length === 0) throw new NotFoundException('Student not found');

    const [profile, joinDate, homeBranch, tags, customFields, customStatus, guardians, notes, medical, bookings, memberships, payments, waivers, belts] =
      await Promise.all([
        this.prismaAuth.user.findUnique({
          where: { id: studentId },
          select: { firstName: true, surname: true, email: true, phone: true, dateOfBirth: true, createdAt: true },
        }),
        db.studentJoinDate.findFirst({ where: { schoolId, studentId }, select: { joinedOn: true } }),
        db.studentHomeBranch.findFirst({ where: { schoolId, studentId }, select: { branch: { select: { name: true } } } }),
        db.studentTag.findMany({ where: { schoolId, studentId }, select: { tag: { select: { name: true } } } }),
        db.customMemberFieldValue.findMany({ where: { schoolId, studentId }, select: { value: true, field: { select: { name: true } } } }),
        db.studentCustomStatus.findFirst({ where: { schoolId, studentId }, select: { status: { select: { name: true } } } }),
        db.guardianLink.findMany({
          where: { studentId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, revokedAt: true, guardian: { select: { firstName: true, surname: true, email: true } } },
        }),
        db.studentNote.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: 'asc' }, select: { body: true, showToMember: true, createdAt: true, editedAt: true } }),
        db.studentMedicalInfo.findFirst({ where: { schoolId, studentId }, select: { body: true, consentedByGuardian: true, consentedAt: true } }),
        db.booking.findMany({
          where: { schoolId, studentId },
          orderBy: { class: { startDate: 'asc' } },
          select: { status: true, checkInMethod: true, class: { select: { title: true, startDate: true } } },
        }),
        db.membership.findMany({
          where: { schoolId, studentId },
          orderBy: { createdAt: 'asc' },
          select: { status: true, frequency: true, startDate: true, expiryDate: true, classesRemaining: true, cancelAt: true, membershipPlan: { select: { title: true } } },
        }),
        db.transaction.findMany({
          where: { schoolId, studentId },
          orderBy: { billingDate: 'asc' },
          select: { kind: true, billingDate: true, amount: true, currency: true, status: true, paymentMethod: true },
        }),
        db.waiverSignature.findMany({
          where: { schoolId, studentId },
          orderBy: { createdAt: 'asc' },
          select: { status: true, method: true, signerFullName: true, signedDate: true, signedWaiverTitle: true, signedWaiverVersion: true },
        }),
        db.studentRank.findMany({
          where: { schoolId, studentId },
          select: { dateOfCurrentRank: true, discipline: { select: { name: true } }, currentRank: { select: { name: true } }, currentStripe: { select: { name: true } } },
        }),
      ]);

    const result = {
      exportedAt: new Date().toISOString(),
      profile: profile && {
        firstName: profile.firstName,
        surname: profile.surname,
        email: profile.email,
        phone: profile.phone,
        dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        accountCreatedAt: profile.createdAt.toISOString(),
      },
      enrolment: enrolment.map((g) => ({ enrolledAt: g.grantedAt.toISOString(), endedAt: g.revokedAt?.toISOString() ?? null, branchName: g.branch?.name ?? null })),
      joinedOn: joinDate?.joinedOn.toISOString().slice(0, 10) ?? null,
      homeBranchName: homeBranch?.branch.name ?? null,
      tags: tags.map((t) => t.tag.name),
      customFields: customFields.map((f) => ({ field: f.field.name, value: f.value })),
      customStatus: customStatus?.status.name ?? null,
      guardians: guardians.map((g) => ({
        name: `${g.guardian.firstName} ${g.guardian.surname}`.trim(),
        email: g.guardian.email,
        linkedAt: g.createdAt.toISOString(),
        endedAt: g.revokedAt?.toISOString() ?? null,
      })),
      notes: notes.map((n) => ({ body: n.body, shownToMember: n.showToMember, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null })),
      medicalInfo: medical && { body: medical.body, consentedByGuardian: medical.consentedByGuardian, consentedAt: medical.consentedAt.toISOString() },
      bookings: bookings.map((b) => ({ class: b.class.title, startsAt: b.class.startDate.toISOString(), status: b.status, checkInMethod: b.checkInMethod })),
      memberships: memberships.map((m) => ({
        plan: m.membershipPlan.title,
        status: m.status,
        frequency: m.frequency,
        startDate: m.startDate.toISOString(),
        expiryDate: m.expiryDate?.toISOString() ?? null,
        classesRemaining: m.classesRemaining,
        cancelAt: m.cancelAt?.toISOString() ?? null,
      })),
      payments: payments.map((p) => ({
        kind: p.kind,
        billingDate: p.billingDate.toISOString(),
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        paymentMethod: p.paymentMethod,
      })),
      waiverSignatures: waivers.map((w) => ({
        waiver: w.signedWaiverTitle,
        version: w.signedWaiverVersion,
        status: w.status,
        method: w.method,
        signerFullName: w.signerFullName,
        signedDate: w.signedDate?.toISOString() ?? null,
      })),
      belts: belts.map((k) => ({ style: k.discipline.name, rank: k.currentStripe?.name ?? k.currentRank.name, since: k.dateOfCurrentRank.toISOString() })),
    };

    await db.studentExportLog.create({
      data: { id: randomUUID(), schoolId, exportedById: callerId, filter: MEMBER_DATA_EXPORT_FILTER, rowCount: 1, studentId },
    });
    return result;
  }
}
