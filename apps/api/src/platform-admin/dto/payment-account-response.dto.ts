import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO for the Platform Admin PaymentAccount read — deliberately NOT the
 * same shape as the tenant-side PaymentAccountResponseDto (payments/dto), which
 * includes `stripeConnectedAccountId` for the tenant's own School/Franchise Owner
 * (a legitimate need — they own the Stripe dashboard this id refers to). Platform
 * Admin's own read excludes it — see this phase's own migration comment
 * (20260927000000_platform_admin_payment_account_read) for why: Support's own
 * confirmed exclusion of this exact field makes it the conservative default here
 * too, not just for Support specifically, and nothing confirms Billing/Payments Ops
 * needs the raw id merely to view configuration status.
 */
export class PlatformAdminPaymentAccountResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  schoolId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  franchiseId!: string | null;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  accountTitle!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  mode!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
