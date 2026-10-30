import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { LateFeeSettingsDto, UpdateLateFeeSettingsDto } from './dto/late-fee.dto';
import { schoolCurrencyRequired, setsNewPrice } from '../common/school-currency';

/**
 * Late fees, the School's choice (v1.3 backlog §3.7; Decision 413, which
 * changes Decision 405 item 4):
 *
 * - Off by default. The owner switches them on, and must tick "I confirm late
 *   fees are legal where my School operates" every time they save them on,
 *   as for the card surcharge (Decision 406). There is no Platform Admin
 *   limit: late fees are illegal in some countries, and each School decides.
 * - A fixed amount (in the School's currency) or any % up to 100 with up to
 *   two decimals, and grace days after the due date: 3 by default, 0 to 30.
 * - The fee itself is added by the daily late-fee job (jobs/late-fee.processor.ts)
 *   as a charge on the member's balance, never charged to a card.
 *
 * Owner only, read and written under the owner's own context (School's RLS),
 * as every other School setting is.
 */
@Injectable()
export class LateFeesService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** GET /schools/{schoolId}/late-fees */
  async getSettings(callerId: string, schoolId: string): Promise<LateFeeSettingsDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.readSettings(callerId, schoolId);
  }

  /** PUT /schools/{schoolId}/late-fees */
  async updateSettings(callerId: string, schoolId: string, dto: UpdateLateFeeSettingsDto): Promise<LateFeeSettingsDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const current = await this.readSettings(callerId, schoolId);
    // Decision 414 item 6: a new fixed amount is a price, so it needs the
    // School's currency even while late fees stay off (the amount is kept).
    if (!current.currency && setsNewPrice(dto.fixedAmount, current.fixedAmount)) throw schoolCurrencyRequired();
    if (dto.enabled) {
      if (dto.type === 'FIXED' && !dto.fixedAmount) {
        throw new BadRequestException({ code: 'LATE_FEE_AMOUNT_REQUIRED', message: 'Set a late fee amount above 0.' });
      }
      if (dto.type === 'PERCENT' && !dto.percentBps) {
        throw new BadRequestException({ code: 'LATE_FEE_PERCENT_REQUIRED', message: 'Set a late fee percentage above 0%, up to 100%.' });
      }
      if (dto.type === 'FIXED' && !current.currency) {
        throw schoolCurrencyRequired();
      }
      if (dto.legalConfirmed !== true) {
        throw new BadRequestException({ code: 'LATE_FEE_LEGAL_CONFIRM_REQUIRED', message: 'Confirm that late fees are legal where your School operates.' });
      }
    }
    const now = new Date();
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          lateFeeEnabled: dto.enabled,
          lateFeeType: dto.type,
          // Each value is kept while off, so switching back on shows it again.
          ...(dto.fixedAmount !== undefined ? { lateFeeFixedAmount: dto.fixedAmount } : {}),
          ...(dto.percentBps !== undefined ? { lateFeePercentBps: dto.percentBps } : {}),
          lateFeeGraceDays: dto.graceDays,
          ...(dto.enabled ? { lateFeeConfirmedAt: now, lateFeeConfirmedById: callerId } : {}),
          // Switched on now (it was off): late fees start from today. Saving
          // while already on keeps the day they were switched on.
          ...(dto.enabled && !current.enabled ? { lateFeeEnabledAt: now } : {}),
        },
        select: { id: true },
      }),
    );
    return this.readSettings(callerId, schoolId);
  }

  private async readSettings(callerId: string, schoolId: string): Promise<LateFeeSettingsDto> {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({
        where: { id: schoolId },
        select: {
          defaultCurrency: true,
          lateFeeEnabled: true,
          lateFeeType: true,
          lateFeeFixedAmount: true,
          lateFeePercentBps: true,
          lateFeeGraceDays: true,
          lateFeeConfirmedAt: true,
          lateFeeEnabledAt: true,
        },
      }),
    );
    if (!school) throw new NotFoundException('School not found');
    return {
      enabled: school.lateFeeEnabled,
      type: school.lateFeeType,
      fixedAmount: school.lateFeeFixedAmount,
      percentBps: school.lateFeePercentBps,
      graceDays: school.lateFeeGraceDays,
      currency: school.defaultCurrency?.toUpperCase() ?? null,
      confirmedAt: school.lateFeeConfirmedAt,
      enabledAt: school.lateFeeEnabled ? school.lateFeeEnabledAt : null,
    };
  }
}
