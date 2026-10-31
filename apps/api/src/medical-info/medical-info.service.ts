import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { isAdultOn } from '../common/decorators/is-birth-date.decorator';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';

/** The longest medical information we keep (a choice to confirm; nothing in
 * Decision 315 sets a length). */
export const MEDICAL_INFO_MAX_LENGTH = 2000;

/** What a sign-up form sends: the text, and the consent tick box. */
export interface MedicalInfoAtSignUp {
  medicalInfo?: string | null;
  medicalConsent?: boolean;
}

/**
 * Decision 315 item 10: medical information at sign-up.
 *
 * - Optional per School (School.medicalInfoEnabled, off by default). When it
 *   is off, a sign-up can't carry any.
 * - Taken only with explicit consent from the member, or from the Guardian
 *   for a child (never the child). Without the consent tick nothing is
 *   stored: the sign-up is refused, so the person can tick it or clear the
 *   text.
 * - Seen only by the School's owners and Branch Staff the owner switched on
 *   ("See medical information"), for the students of their own branches
 *   (TenantAuthorizationService.assertMaySeeMedicalInfo). No member-facing
 *   endpoint returns it.
 * - Erased with the student's account (the row cascades with the User row,
 *   and a Guardian's baseline consent withdrawal deletes it), and with the
 *   School (cascade on delete; deleted outright when a closed School is
 *   anonymised instead, TenantLifecyclePurgeProcessor).
 *
 * Health data is special-category personal data (GDPR Art. 9, LGPD Art. 11),
 * so StudentMedicalInfo is read and written only on the jobs connection after
 * these checks: RLS is on and forced, and ultm8_app has no grant.
 */
@Injectable()
export class MedicalInfoService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /**
   * The text to store from a sign-up form, or null when there is none.
   * Refuses medical information the School doesn't ask for, or that comes
   * without the consent tick. Call it before anything is written.
   */
  async checkAtSignUp(schoolId: string, input: MedicalInfoAtSignUp): Promise<string | null> {
    const text = input.medicalInfo?.trim() ?? '';
    if (!text) return null;
    const school = await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { medicalInfoEnabled: true } });
    if (!school?.medicalInfoEnabled) {
      throw new BadRequestException("This School doesn't ask for medical information.");
    }
    if (input.medicalConsent !== true) {
      throw new BadRequestException('Medical information is kept only with consent. Tick the consent box, or leave the medical information empty.');
    }
    return text;
  }

  /**
   * Who may consent for `studentId` when `callerId` is joining them: the
   * member themselves (not a Guardian-linked child), or the child's Guardian.
   * Staff enrolling someone can't give it for them.
   */
  async assertMayConsent(callerId: string, studentId: string, as: 'self' | 'guardian' | 'staff'): Promise<void> {
    if (as === 'staff') {
      throw new ForbiddenException('Only the member, or the Guardian for a child, can give medical information.');
    }
    if (as === 'self') {
      // A child (a Guardian-linked account, or anyone under 18: Decision 67)
      // never consents for themselves. An unknown date of birth counts as
      // under 18, as the waiver adult check does.
      const linked = await this.prismaJobs.guardianLink.findFirst({ where: { studentId: callerId, revokedAt: null }, select: { id: true } });
      const me = await this.prismaAuth.user.findUnique({ where: { id: callerId }, select: { dateOfBirth: true } });
      if (linked || (me?.dateOfBirth && !isAdultOn(me.dateOfBirth))) {
        throw new ForbiddenException("A child's medical information is given by their Guardian.");
      }
      if (!me?.dateOfBirth) {
        throw new ForbiddenException('Add your date of birth to your profile before giving medical information.');
      }
    }
  }

  /** Stores consented medical information for a student at a School,
   * replacing any already there. */
  async record(schoolId: string, studentId: string, body: string, consent: { byId: string; byGuardian: boolean; at: Date }) {
    await this.prismaJobs.studentMedicalInfo.upsert({
      where: { schoolId_studentId: { schoolId, studentId } },
      create: {
        id: randomUUID(),
        schoolId,
        studentId,
        body,
        consentedById: consent.byId,
        consentedByGuardian: consent.byGuardian,
        consentedAt: consent.at,
      },
      update: { body, consentedById: consent.byId, consentedByGuardian: consent.byGuardian, consentedAt: consent.at },
    });
  }

  /** GET /schools/{schoolId}/students/{studentId}/medical-info. */
  async getForStaff(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertMaySeeMedicalInfo(callerId, schoolId, studentId);
    const row = await this.prismaJobs.studentMedicalInfo.findUnique({
      where: { schoolId_studentId: { schoolId, studentId } },
      select: { body: true, consentedById: true, consentedByGuardian: true, consentedAt: true, updatedAt: true },
    });
    if (!row) return { medicalInfo: null };
    const names = await resolveUserNames(this.prismaAuth, row.consentedById ? [row.consentedById] : []);
    const who = row.consentedById ? names.get(row.consentedById) : undefined;
    return {
      medicalInfo: {
        body: row.body,
        consentedByName: who ? `${who.firstName} ${who.surname}`.trim() : null,
        consentedByGuardian: row.consentedByGuardian,
        consentedAt: row.consentedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }
}
