import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInMethod, PackRecharge } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { AttendanceService } from '../attendance/attendance.service';
import { QrTokenService } from '../attendance/qr-token.service';
import { assertAtKioskBranch, frontDeskLookupOwner, FrontDeskCheckInService, KIOSK_BOOK_FIRST } from '../attendance/front-desk-check-in.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { CreatePackRechargeDto, MyPackRechargeDto, PackRechargeDto, PackRechargeStatusDto } from './dto/pack-recharge.dto';

type Kiosk = { sessionId: string; branchId: string | null };

/**
 * Decision 393 (Decision 316 item 7, handover F8): "Pack used up: buy the
 * same pack". When a Class Pack has no classes left at check-in, the desk (or
 * the tablet) asks for a recharge. The member, or their Guardian, sees the
 * same pack in the app and buys it there. The desk's card then sees it paid
 * and finishes the check-in for the same Classes.
 *
 * The person was identified when the recharge was asked for (on a tablet, by
 * their app QR or personal code, Decision 388) and pays in their own app, so
 * the finishing check-in may book, recording the same method.
 *
 * Recharges are read and written on the jobs connection, after these checks.
 */
@Injectable()
export class PackRechargesService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly attendance: AttendanceService,
    private readonly qrTokens: QrTokenService,
    private readonly deskCheckIn: FrontDeskCheckInService,
  ) {}

  async create(callerId: string, schoolId: string, dto: CreatePackRechargeDto, kiosk?: Kiosk): Promise<PackRechargeDto> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'bookings');
    const { studentId } = dto;
    const enrolled = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!enrolled) {
      throw new NotFoundException({ code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." });
    }
    const method = await this.methodOf(callerId, schoolId, dto, kiosk);

    const classes = await this.prismaJobs.class.findMany({ where: { id: { in: dto.classIds }, schoolId, cancelledAt: null, archivedAt: null } });
    if (classes.length !== dto.classIds.length) {
      throw new NotFoundException('Class not found');
    }
    for (const cls of classes) {
      await this.tenantAuth.assertStaffAtSchool(callerId, schoolId, cls.branchId);
      await this.tenantAuth.assertStaffMay(callerId, schoolId, 'bookings', cls.branchId);
      assertAtKioskBranch(kiosk, cls.branchId);
      await this.attendance.assertWithinWindow(cls);
    }
    // The offer lasts while the last of these Classes can still be checked in to.
    const expiresAt = new Date(Math.max(...classes.map((c) => (c.qrAttendanceEndAt ?? c.endDate).getTime())));

    const now = new Date();
    const usedUp = await this.prismaJobs.membership.findFirst({
      where: {
        studentId,
        schoolId,
        status: 'ACTIVE',
        classesRemaining: { lte: 0 },
        membershipPlan: { type: 'CLASS_PACK' },
        OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      include: { membershipPlan: true },
    });
    if (!usedUp) {
      throw new ConflictException({ code: 'NO_PACK_TO_RECHARGE', message: 'This person has no used-up Class Pack to buy again.' });
    }
    const plan = usedUp.membershipPlan;
    if (plan.archivedAt) {
      throw new ConflictException({ code: 'PACK_NOT_FOR_SALE', message: 'This pack is no longer sold. Ask at the desk about another plan.' });
    }

    // One open offer per person and pack: asking again updates it.
    const open = await this.prismaJobs.packRecharge.findFirst({
      where: { studentId, membershipPlanId: plan.id, completedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    const data = { classIds: dto.classIds, requestedById: callerId, frontDeskSessionId: kiosk?.sessionId ?? null, checkInMethod: method, expiresAt };
    const recharge = open
      ? await this.prismaJobs.packRecharge.update({ where: { id: open.id }, data })
      : await this.prismaJobs.packRecharge.create({ data: { ...data, schoolId, studentId, membershipPlanId: plan.id } });
    return { id: recharge.id, planTitle: plan.title, price: plan.price, currency: plan.currency, expiresAt: recharge.expiresAt };
  }

  async status(callerId: string, schoolId: string, id: string, kiosk?: Kiosk): Promise<PackRechargeStatusDto> {
    const recharge = await this.loadForDesk(callerId, schoolId, id, kiosk);
    return { paid: await this.isPaid(recharge), expired: recharge.expiresAt <= new Date(), completed: recharge.completedAt !== null };
  }

  /** Once paid, checks the person in to the recharge's Classes, as the desk would. */
  async complete(callerId: string, schoolId: string, id: string, kiosk?: Kiosk) {
    const recharge = await this.loadForDesk(callerId, schoolId, id, kiosk);
    if (!(await this.isPaid(recharge))) {
      throw new ConflictException({ code: 'RECHARGE_NOT_PAID', message: "The pack hasn't been paid for yet." });
    }
    const result = await this.deskCheckIn.checkIn(callerId, schoolId, { studentId: recharge.studentId, classIds: recharge.classIds }, kiosk, {
      method: recharge.checkInMethod,
    });
    if (result.done) {
      await this.prismaJobs.packRecharge.updateMany({ where: { id: recharge.id, completedAt: null }, data: { completedAt: new Date() } });
    }
    return result;
  }

  /** The caller's own open offers, and their children's (Guardian). */
  async mine(callerId: string): Promise<{ items: MyPackRechargeDto[] }> {
    const children = await this.prismaJobs.guardianLink.findMany({ where: { guardianId: callerId, revokedAt: null }, select: { studentId: true } });
    const rows = await this.prismaJobs.packRecharge.findMany({
      where: { studentId: { in: [callerId, ...children.map((c) => c.studentId)] }, completedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      include: {
        school: { select: { name: true } },
        student: { select: { firstName: true } },
        membershipPlan: { select: { id: true, schoolId: true, type: true, title: true, price: true, currency: true, expiryDurationDays: true, classesIncluded: true, visible: true, archivedAt: true } },
      },
    });
    const items: MyPackRechargeDto[] = [];
    for (const r of rows) {
      if (r.membershipPlan.archivedAt || (await this.isPaid(r))) continue;
      const { archivedAt: _archived, ...plan } = r.membershipPlan;
      items.push({
        id: r.id,
        schoolId: r.schoolId,
        schoolName: r.school.name,
        studentId: r.studentId,
        childFirstName: r.studentId === callerId ? null : r.student.firstName,
        plan,
        expiresAt: r.expiresAt,
      });
    }
    return { items };
  }

  // ---------------------------------------------------------------------------

  /** How the person was identified. On a tablet a lookup is needed: its name
   * search proves nothing (Decision 388). */
  private async methodOf(callerId: string, schoolId: string, dto: CreatePackRechargeDto, kiosk?: Kiosk): Promise<CheckInMethod> {
    if (!dto.lookupToken) {
      if (kiosk) throw new BadRequestException(KIOSK_BOOK_FIRST);
      return 'INSTRUCTOR_MANUAL';
    }
    const lookup = this.qrTokens.verifyDeskLookup(dto.lookupToken);
    const owner = kiosk ? frontDeskLookupOwner(kiosk.sessionId) : callerId;
    if (lookup.deskStudentId !== dto.studentId || lookup.schoolId !== schoolId || lookup.staffId !== owner) {
      throw new BadRequestException('This scan belongs to a different Student.');
    }
    if (lookup.via === 'CODE') return 'PERSONAL_CODE';
    await this.attendance.assertCameraConsentNotWithdrawn(dto.studentId);
    return 'INSTRUCTOR_SCAN';
  }

  /** Staff at the School may see a recharge; a tablet only its own. */
  private async loadForDesk(callerId: string, schoolId: string, id: string, kiosk?: Kiosk): Promise<PackRecharge> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'bookings');
    const recharge = await this.prismaJobs.packRecharge.findFirst({ where: { id, schoolId } });
    if (!recharge || (kiosk && recharge.frontDeskSessionId !== kiosk.sessionId)) {
      throw new NotFoundException('Pack recharge not found');
    }
    return recharge;
  }

  /** Paid: a Membership on the same plan, made after the offer and still
   * with classes left. A purchase still waiting for its payment doesn't
   * count (no Membership yet). */
  private async isPaid(recharge: Pick<PackRecharge, 'studentId' | 'membershipPlanId' | 'createdAt'>): Promise<boolean> {
    const bought = await this.prismaJobs.membership.findMany({
      where: { studentId: recharge.studentId, membershipPlanId: recharge.membershipPlanId, createdAt: { gte: recharge.createdAt } },
      select: { status: true, expiryDate: true, classesRemaining: true },
    });
    return bought.some((m) => isMembershipLive(m));
  }
}
