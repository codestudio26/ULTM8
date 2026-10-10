import { ApiProperty } from '@nestjs/swagger';

/** Response for POST /platform-admin/payment-accounts/:id/rotate-credential —
 * mirrors ConnectOnboardingResponseDto (apps/api/src/payments/dto/
 * payment-account-response.dto.ts), the tenant-side equivalent this reuses the
 * same underlying Stripe mechanism as (see
 * PlatformAdminPaymentAccountsService.initiateCredentialRotation()'s own
 * comment). A fresh Account Link the engineer relays to the tenant to complete —
 * not something Platform Admin fills in on the tenant's own behalf, since Stripe
 * Connect onboarding collects the tenant's own business/banking details. */
export class RotateCredentialResponseDto {
  @ApiProperty({ description: 'Stripe Account Link URL — single-use, short-lived per Stripe\'s own onboarding-link semantics.' })
  onboardingUrl!: string;
}
