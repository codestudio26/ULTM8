import { Injectable } from '@nestjs/common';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { checkInCodeDigitsAsRead, codeDigitsToSave } from '../front-desk/check-in-code';
import { CHECK_IN_RULES_SELECT, checkInRulesFrom } from './check-in-rules';
import { CheckInRulesDto } from './dto/check-in-rules.dto';

/** Settings → Check-in rules (Decision 394). The owners, and Branch Staff the
 * owner switches on, read and change them. Read and written through
 * ultm8_jobs after that check: the School row's own policy lets only owners
 * update it. */
@Injectable()
export class CheckInRulesService {
  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  async get(callerId: string, schoolId: string): Promise<CheckInRulesDto> {
    await this.tenantAuth.assertMayManageCheckInRules(callerId, schoolId);
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { ...CHECK_IN_RULES_SELECT, checkInCodeDigits: true } });
    // Decision 417 as the page reads it (round 6, R-1): past 500 Students, 6.
    return this.toDto({ ...school, checkInCodeDigits: await checkInCodeDigitsAsRead(this.prismaJobs, schoolId, school.checkInCodeDigits) });
  }

  async update(callerId: string, schoolId: string, dto: CheckInRulesDto): Promise<CheckInRulesDto> {
    await this.tenantAuth.assertMayManageCheckInRules(callerId, schoolId);
    // The value the page showed is never refused (round 6, R-1).
    const codeDigits = await codeDigitsToSave(this.prismaJobs, schoolId, dto.codeDigits);
    const school = await this.prismaJobs.school.update({
      where: { id: schoolId },
      data: {
        checkInOpensMinutesBeforeStart: dto.opensMinutesBeforeStart,
        checkInClosesMinutesAfterStart: dto.closesMinutesAfterStart,
        checkInRequireWaiver: dto.requireWaiver,
        checkInOtherBranches: dto.otherBranches,
        checkInVisitors: dto.visitors,
        checkInSeveralClasses: dto.severalClasses,
        checkInFrozenMembers: dto.frozenMembers,
        checkInShowBeltProgress: dto.showBeltProgress,
        checkInBlockOverdueDays: dto.blockOverdueDays,
        checkInRequireBooking: dto.requireBooking,
        openMatUsesClassCredit: dto.openMatUsesCredit,
        checkInCodeDigits: codeDigits,
      },
      select: { ...CHECK_IN_RULES_SELECT, checkInCodeDigits: true },
    });
    return this.toDto(school);
  }

  private toDto(school: Parameters<typeof checkInRulesFrom>[0] & { checkInCodeDigits: number }): CheckInRulesDto {
    return { ...checkInRulesFrom(school), codeDigits: school.checkInCodeDigits === 6 ? 6 : 4 };
  }
}
