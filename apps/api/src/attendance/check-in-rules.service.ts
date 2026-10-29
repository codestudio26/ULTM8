import { Injectable } from '@nestjs/common';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
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
    return this.toDto(school);
  }

  async update(callerId: string, schoolId: string, dto: CheckInRulesDto): Promise<CheckInRulesDto> {
    await this.tenantAuth.assertMayManageCheckInRules(callerId, schoolId);
    const school = await this.prismaJobs.school.update({
      where: { id: schoolId },
      data: {
        checkInOpensMinutesBeforeStart: dto.opensMinutesBeforeStart,
        checkInClosesMinutesAfterStart: dto.closesMinutesAfterStart,
        checkInRequireWaiver: dto.requireWaiver,
        checkInOtherBranches: dto.otherBranches,
        checkInVisitors: dto.visitors,
        checkInSeveralClasses: dto.severalClasses,
        checkInCodeDigits: dto.codeDigits,
      },
      select: { ...CHECK_IN_RULES_SELECT, checkInCodeDigits: true },
    });
    return this.toDto(school);
  }

  private toDto(school: Parameters<typeof checkInRulesFrom>[0] & { checkInCodeDigits: number }): CheckInRulesDto {
    return { ...checkInRulesFrom(school), codeDigits: school.checkInCodeDigits === 6 ? 6 : 4 };
  }
}
