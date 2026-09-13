import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminPaymentAccountsService } from './platform-admin-payment-accounts.service';
import { PlatformAdminPaymentAccountResponseDto } from './dto/payment-account-response.dto';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';

/** Slice 6 of PlatformAdminModule — see PlatformAdminPaymentAccountsService's own
 * header comment for scope. Both routes are BILLING_PAYMENTS_OPS/FULL_ADMIN-only
 * (enforced in the service, not the guard, same convention
 * PlatformAdminUsersController already uses). No class-level route prefix, same
 * shape the tenant-side PaymentsController already uses for its own
 * schools/:schoolId/payment-account and franchises/:franchiseId/payment-account
 * routes — mirrored here under platform-admin/ instead of reusing that controller,
 * since this read has a genuinely different authorization gate and response shape
 * (no stripeConnectedAccountId). */
@ApiTags('platform-admin-payment-accounts')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller()
export class PlatformAdminPaymentAccountsController {
  constructor(private readonly platformAdminPaymentAccounts: PlatformAdminPaymentAccountsService) {}

  @ApiOkResponse({ type: PlatformAdminPaymentAccountResponseDto })
  @Get('platform-admin/schools/:schoolId/payment-account')
  findForSchool(@CurrentAdminUser() admin: AdminJwtPayload, @Param('schoolId') schoolId: string) {
    return this.platformAdminPaymentAccounts.findForSchool(admin.sub, schoolId);
  }

  @ApiOkResponse({ type: PlatformAdminPaymentAccountResponseDto })
  @Get('platform-admin/franchises/:franchiseId/payment-account')
  findForFranchise(@CurrentAdminUser() admin: AdminJwtPayload, @Param('franchiseId') franchiseId: string) {
    return this.platformAdminPaymentAccounts.findForFranchise(admin.sub, franchiseId);
  }
}
