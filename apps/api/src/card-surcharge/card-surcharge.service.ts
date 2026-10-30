import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditAction, AuditLogService } from '../platform-admin/audit-log.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { readCardSurchargeBps } from '../payments/card-surcharge';
import { CardSurchargeSettingsDto, UpdateCardSurchargeSettingsDto } from './dto/card-surcharge.dto';

/**
 * Card surcharge (backlog 3.8, Decision 406). Off everywhere by default:
 *
 * - Platform Admin keeps the list of countries where a surcharge is allowed.
 *   It starts empty and a country is added only after legal review (consumer
 *   card surcharges are illegal in the UK and the EU). Billing & Payments Ops
 *   and Full Admins change it, the tiers that already own payment settings
 *   (PlatformAdminPaymentAccountsService); any admin may read it. Written on
 *   the Platform Admin connection and audit-logged, like the School trial.
 * - Where the School's country (its address) is on the list, the owner sets a
 *   % up to 3% and confirms surcharges are legal where the School operates.
 *   Otherwise the setting is refused. A country taken off the list later
 *   leaves the School's stored % alone; it just stops applying
 *   (card_surcharge_bps(), read when a member pays).
 *
 * Where it is charged: MembershipsService.purchase() (one-off card payments).
 */
@Injectable()
export class CardSurchargeService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Platform Admin: the allow-list
  // ---------------------------------------------------------------------------

  async listCountries() {
    const items = await this.prismaPlatformAdmin.cardSurchargeCountry.findMany({ orderBy: { countryCode: 'asc' } });
    return { items };
  }

  /** Adding a country already on the list changes nothing and logs nothing. */
  async addCountry(adminUserId: string, countryCode: string) {
    await this.assertBillingOrFullAdmin(adminUserId);
    const code = countryCode.toUpperCase();
    const existing = await this.prismaPlatformAdmin.cardSurchargeCountry.findUnique({ where: { countryCode: code } });
    if (existing) return existing;
    const created = await this.prismaPlatformAdmin.cardSurchargeCountry.upsert({ where: { countryCode: code }, create: { countryCode: code }, update: {} });
    await this.auditLog.record({ adminUserId, action: AuditAction.ADD_CARD_SURCHARGE_COUNTRY, targetType: 'CardSurchargeCountry', targetId: code });
    return created;
  }

  async removeCountry(adminUserId: string, countryCode: string): Promise<void> {
    await this.assertBillingOrFullAdmin(adminUserId);
    const code = countryCode.toUpperCase();
    const { count } = await this.prismaPlatformAdmin.cardSurchargeCountry.deleteMany({ where: { countryCode: code } });
    if (count === 0) {
      throw new NotFoundException('This country is not on the card surcharge list.');
    }
    await this.auditLog.record({ adminUserId, action: AuditAction.REMOVE_CARD_SURCHARGE_COUNTRY, targetType: 'CardSurchargeCountry', targetId: code });
  }

  private async assertBillingOrFullAdmin(adminUserId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: adminUserId } });
    if (
      !caller ||
      caller.revokedAt ||
      (caller.subRole !== AdminSubRole.BILLING_PAYMENTS_OPS && caller.subRole !== AdminSubRole.FULL_ADMIN)
    ) {
      throw new ForbiddenException('Only Billing/Payments Ops or a Full Platform Admin may change where card surcharges are allowed.');
    }
  }

  // ---------------------------------------------------------------------------
  // The School owner's setting
  // ---------------------------------------------------------------------------

  async getSettings(callerId: string, schoolId: string): Promise<CardSurchargeSettingsDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.readSettings(callerId, schoolId);
  }

  async updateSettings(callerId: string, schoolId: string, dto: UpdateCardSurchargeSettingsDto): Promise<CardSurchargeSettingsDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const current = await this.readSettings(callerId, schoolId);
    if (!current.available) {
      throw new BadRequestException("Card surcharges are not allowed in your School's country.");
    }
    if (dto.enabled && dto.bps < 1) {
      throw new BadRequestException('Set a card surcharge above 0%, up to 3%.');
    }
    if (dto.enabled && dto.legalConfirmed !== true) {
      throw new BadRequestException('Confirm that card surcharges are legal where your School operates.');
    }
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          cardSurchargeEnabled: dto.enabled,
          cardSurchargeBps: dto.bps,
          ...(dto.enabled ? { cardSurchargeConfirmedAt: new Date(), cardSurchargeConfirmedById: callerId } : {}),
        },
        select: { id: true },
      }),
    );
    return this.readSettings(callerId, schoolId);
  }

  private async readSettings(callerId: string, schoolId: string): Promise<CardSurchargeSettingsDto> {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const school = await tx.school.findUnique({
        where: { id: schoolId },
        select: { addressCountry: true, cardSurchargeEnabled: true, cardSurchargeBps: true, cardSurchargeConfirmedAt: true },
      });
      if (!school) throw new NotFoundException('School not found');
      const country = school.addressCountry ? school.addressCountry.toUpperCase() : null;
      const listed = country ? await tx.cardSurchargeCountry.findUnique({ where: { countryCode: country }, select: { countryCode: true } }) : null;
      return {
        available: !!listed,
        country,
        enabled: school.cardSurchargeEnabled,
        bps: school.cardSurchargeBps,
        confirmedAt: school.cardSurchargeConfirmedAt,
        applies: (await readCardSurchargeBps(tx, schoolId)) > 0,
      };
    });
  }
}
