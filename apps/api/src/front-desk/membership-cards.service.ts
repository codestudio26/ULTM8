import { Injectable } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { StudentCheckInCodesService } from './student-check-in-codes.service';
import type { MembershipCardDto } from './dto/front-desk.dto';

/**
 * Membership cards (backlog 3.11, Decision 398): the School, the student's
 * photo and name, their personal check-in code and the memberships in effect
 * now. A card carries no QR code: a printed QR would never change, so a copy
 * could check anyone in. The app shows the live QR beside its card instead.
 */
@Injectable()
export class MembershipCardsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly checkInCodes: StudentCheckInCodesService,
  ) {}

  /** GET /schools/{schoolId}/students/{studentId}/membership-card: the
   * Student, their Guardian, or staff who cover them (the check-in code's own
   * check). */
  async card(callerId: string, schoolId: string, studentId: string): Promise<MembershipCardDto> {
    const { code } = await this.checkInCodes.get(callerId, schoolId, studentId);
    // Read as the Student: the caller has been checked above, and only the
    // card's fields leave this method.
    const { school, user, memberships } = await this.prismaApp.withTenantContext(studentId, async (tx) => ({
      school: await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, logoUrl: true } }),
      user: await tx.user.findUniqueOrThrow({ where: { id: studentId }, select: { firstName: true, surname: true, profilePhotoUrl: true } }),
      memberships: await tx.membership.findMany({
        where: { studentId, schoolId },
        orderBy: { startDate: 'asc' },
        select: { status: true, expiryDate: true, classesRemaining: true, membershipPlan: { select: { title: true, type: true } } },
      }),
    }));
    const now = new Date();
    return {
      schoolId,
      schoolName: school.name,
      schoolLogoUrl: school.logoUrl,
      studentId,
      firstName: user.firstName,
      surname: user.surname,
      photoUrl: user.profilePhotoUrl,
      checkInCode: code,
      memberships: memberships
        .filter((m) => isMembershipLive(m, now))
        .map((m) => ({
          title: m.membershipPlan.title,
          type: m.membershipPlan.type,
          expiryDate: m.expiryDate?.toISOString() ?? null,
          classesRemaining: m.classesRemaining,
        })),
    };
  }

  /** GET /membership-cards/me: one card for each School the caller is a
   * Student at. */
  async mine(callerId: string): Promise<{ items: MembershipCardDto[] }> {
    const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: { userId: callerId, role: 'STUDENT', revokedAt: null, schoolId: { not: null }, school: { archivedAt: null } },
        orderBy: { createdAt: 'asc' },
        select: { schoolId: true },
      }),
    );
    const schoolIds = [...new Set(grants.map((g) => g.schoolId as string))];
    const items: MembershipCardDto[] = [];
    for (const schoolId of schoolIds) items.push(await this.card(callerId, schoolId, callerId));
    return { items };
  }
}
