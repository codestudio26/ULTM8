import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { QrTokenService } from '../attendance/qr-token.service';
import { checkInCodeDigits, withUniqueCode } from './check-in-code';

const CODE_NOT_FOUND = { code: 'CHECK_IN_CODE_NOT_FOUND', message: "That check-in code isn't right." };
const NOT_A_STUDENT_HERE = { code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." };

/**
 * Personal check-in codes (Decision 315 item 2; built as Decision 384, handover
 * F3): a backup to the app QR. ULTM8 makes each Student one code per School,
 * School.checkInCodeDigits long and unique in the School. The Student and
 * their Guardian can see it, staff can issue a new one, and the Student can't
 * change it. Typed at the desk, it gives the same five-minute lookup as a
 * scanned QR, and the check-in is recorded as PERSONAL_CODE.
 */
@Injectable()
export class StudentCheckInCodesService {
  private readonly logger = new Logger(StudentCheckInCodesService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardians: GuardiansService,
    private readonly qrTokens: QrTokenService,
  ) {}

  /** GET /schools/{schoolId}/students/{studentId}/check-in-code: the Student
   * themself, their Guardian, or staff who cover them. Made the first time
   * it's asked for. */
  async get(callerId: string, schoolId: string, studentId: string) {
    if (callerId !== studentId) {
      const isGuardian = await this.guardians.assertGuardianOfStudent(callerId, studentId).then(
        () => true,
        () => false,
      );
      if (!isGuardian) await this.tenantAuth.assertStaffCoversStudent(callerId, schoolId, studentId);
    }
    await this.assertEnrolled(schoolId, studentId);
    const existing = await this.prismaJobs.studentCheckInCode.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { code: true } });
    if (existing) return { code: existing.code };
    // Made in the Student's own context, whoever asked (the RLS insert policy
    // lets a current Student create their own, and nobody else but staff).
    const digits = await checkInCodeDigits(this.prismaJobs, schoolId);
    try {
      return {
        code: await withUniqueCode(digits, (code) =>
          this.prismaApp.withTenantContext(studentId, (tx) => tx.studentCheckInCode.create({ data: { schoolId, studentId, code } })),
        ),
      };
    } catch (err) {
      // Two first views at once: the other one made it.
      const made = await this.prismaJobs.studentCheckInCode.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { code: true } });
      if (made) return { code: made.code };
      throw err;
    }
  }

  /** POST /schools/{schoolId}/students/{studentId}/check-in-code: staff who
   * cover the Student issue a new one (the old one stops working). */
  async renew(callerId: string, schoolId: string, studentId: string) {
    await this.tenantAuth.assertStaffCoversStudent(callerId, schoolId, studentId);
    await this.assertEnrolled(schoolId, studentId);
    const digits = await checkInCodeDigits(this.prismaJobs, schoolId);
    const code = await withUniqueCode(digits, (c) =>
      this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.studentCheckInCode.upsert({ where: { schoolId_studentId: { schoolId, studentId } }, create: { schoolId, studentId, code: c }, update: { code: c } }),
      ),
    );
    return { code };
  }

  /** A code typed at the desk: whose it is, and a lookup token to check them in
   * with. `lookupOwner` as for AttendanceService.deskQrLookup. A wrong code is
   * logged; the routes are rate-limited. */
  async lookup(schoolId: string, code: string, lookupOwner: string, where: string) {
    const match = await this.prismaJobs.studentCheckInCode.findUnique({ where: { schoolId_code: { schoolId, code } }, select: { studentId: true } });
    if (!match) {
      this.logger.warn(`Wrong personal check-in code at School ${schoolId} (${where})`);
      throw new NotFoundException(CODE_NOT_FOUND);
    }
    await this.assertEnrolled(schoolId, match.studentId);
    const { token, expiresAt } = this.qrTokens.signDeskLookup({ deskStudentId: match.studentId, schoolId, staffId: lookupOwner, via: 'CODE' });
    return { studentId: match.studentId, lookupToken: token, expiresAt: expiresAt.toISOString() };
  }

  /** POST /schools/{schoolId}/front-desk/code-lookups: staff at the desk. */
  async staffLookup(callerId: string, schoolId: string, code: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const r = await this.lookup(schoolId, code, callerId, `staff ${callerId}`);
    const user = await this.prismaApp.withTenantContext(r.studentId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: r.studentId }, select: { firstName: true, surname: true, profilePhotoUrl: true } }),
    );
    return { ...r, firstName: user.firstName, surname: user.surname, profilePhotoUrl: user.profilePhotoUrl };
  }

  private async assertEnrolled(schoolId: string, studentId: string) {
    // Read via ultm8_jobs: Branch Staff and coaches can't see every RoleGrant.
    const enrolled = await this.prismaJobs.roleGrant.findFirst({
      where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    if (!enrolled) throw new NotFoundException(NOT_A_STUDENT_HERE);
  }
}
