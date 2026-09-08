import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaymentsService } from './payments.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { ConnectOnboardingResponseDto, PaymentAccountResponseDto } from './dto/payment-account-response.dto';

// PaymentAccount CRUD + Stripe Connect Express onboarding + webhook receiving only
// this phase — see the Phase 8 kickoff prompt for the full scoping rationale. No
// checkout, no refunds, no Cash/Bank confirmation, no Franchise-fee automation, no
// SubscriptionPlan/white-label billing — all deferred to whenever Phase 9
// (MembershipsModule) builds the entities they attach to.
@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ---- School side (fully reachable this phase) ----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: PaymentAccountResponseDto })
  @Post('schools/:schoolId/payment-accounts')
  createForSchool(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreatePaymentAccountDto,
  ) {
    return this.paymentsService.createForSchool(user.sub, schoolId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PaymentAccountResponseDto })
  @Get('schools/:schoolId/payment-account')
  findForSchool(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.paymentsService.findForSchool(user.sub, schoolId);
  }

  // ---- Franchise side (schema-correct, practically unreachable this phase — see
  // PaymentsService's own header comment) ----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ type: PaymentAccountResponseDto })
  @Post('franchises/:franchiseId/payment-accounts')
  createForFranchise(
    @CurrentUser() user: JwtPayload,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: CreatePaymentAccountDto,
  ) {
    return this.paymentsService.createForFranchise(user.sub, franchiseId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: PaymentAccountResponseDto })
  @Get('franchises/:franchiseId/payment-account')
  findForFranchise(@CurrentUser() user: JwtPayload, @Param('franchiseId') franchiseId: string) {
    return this.paymentsService.findForFranchise(user.sub, franchiseId);
  }

  // ---- Stripe Connect Express onboarding ----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: ConnectOnboardingResponseDto })
  @Post('payment-accounts/:id/connect/onboard')
  initiateConnectOnboarding(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.paymentsService.initiateConnectOnboarding(user.sub, id);
  }

  // ---- Cash/Bank Transfer settlement confirmation (Phase 9) ----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('transactions/:id/confirm')
  confirmTransaction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.paymentsService.confirmTransaction(user.sub, id);
  }

  // ---- Webhook receiving — Stripe calls this directly, no ULTM8 access token ----

  /**
   * Deliberately NO @UseGuards(JwtAuthGuard) — Stripe itself calls this endpoint; it
   * has no ULTM8-issued access token to present. Authenticity is established
   * entirely by the Stripe-Signature header + STRIPE_WEBHOOK_SECRET
   * (PaymentsService.handleIncomingWebhook -> StripeClientService.constructWebhookEvent),
   * not by JwtAuthGuard — an unsigned or wrongly-signed request is rejected there,
   * before anything is enqueued.
   *
   * Reads `req.rawBody` (populated by main.ts's `NestFactory.create(AppModule,
   * { rawBody: true })`) rather than the parsed `@Body()` — signature verification
   * needs the exact bytes Stripe signed, not a re-serialized JSON object. Explicitly
   * checked for undefined rather than asserted, since a missing rawBody here would
   * otherwise surface as a confusing signature-mismatch error from deep inside the
   * Stripe SDK instead of a clear "this endpoint is misconfigured" one.
   */
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post('payments/webhooks/stripe')
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) {
      throw new BadRequestException('Raw body unavailable — check rawBody: true in main.ts bootstrap');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }
    await this.paymentsService.handleIncomingWebhook(req.rawBody, signature);
    return { received: true };
  }
}
