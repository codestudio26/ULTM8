import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ChargesService } from './charges.service';
import {
  CancelChargeDto,
  ChargeBalancesResponseDto,
  GiveCreditDto,
  RefundChargePaymentDto,
  ResendInvoiceResponseDto,
  ChargeAutoPayResponseDto,
  ChargeCheckoutResponseDto,
  SetChargeAutoPayDto,
  StartChargeCheckoutDto,
  ChargePermissionDto,
  ChargePermissionListDto,
  ChargeResponseDto,
  CreateChargeDto,
  MemberChargesResponseDto,
  RecordChargePaymentDto,
  RecordChargePaymentResponseDto,
  SetChargePermissionDto,
  StandardTaxRateListDto,
  StudentChargesResponseDto,
} from './dto/charge.dto';

/** Staff-created charges and the member balance (v1.3 backlog §3.6;
 * Decisions 303, 338, 411): step 1, charges and desk payments; step 2, paying
 * in the app and automatic payment with a saved card; step 4, refunds, credit
 * and resending an invoice (the reports are ChargeReportsController). */
@ApiTags('charges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  /** ULTM8's standard tax rate per country, pre-filled when a School picks its country (Decision 411). */
  @ApiOkResponse({ type: StandardTaxRateListDto })
  @Get('tax-rates')
  taxRates() {
    return this.charges.standardTaxRates();
  }

  /** A student's charges, desk payments and balance: the owner, and staff who cover the student and may create, cancel or take payments. */
  @ApiOkResponse({ type: StudentChargesResponseDto })
  @Get('schools/:schoolId/students/:studentId/charges')
  listForStaff(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.charges.listForStaff(user.sub, schoolId, studentId);
  }

  @ApiCreatedResponse({ type: ChargeResponseDto })
  @Post('schools/:schoolId/students/:studentId/charges')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CreateChargeDto,
  ) {
    return this.charges.create(user.sub, schoolId, studentId, dto);
  }

  @ApiCreatedResponse({ type: ChargeResponseDto })
  @Post('schools/:schoolId/charges/:chargeId/cancel')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Body() dto: CancelChargeDto,
  ) {
    return this.charges.cancel(user.sub, schoolId, chargeId, dto);
  }

  /** Waive a late fee (Decision 413): cancels it, by the owner or staff with "Can cancel charges", with no reason asked for. */
  @ApiCreatedResponse({ type: ChargeResponseDto })
  @Post('schools/:schoolId/charges/:chargeId/waive-late-fee')
  waiveLateFee(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('chargeId', ParseUUIDPipe) chargeId: string) {
    return this.charges.cancel(user.sub, schoolId, chargeId, {}, true);
  }

  @ApiCreatedResponse({ type: RecordChargePaymentResponseDto })
  @Post('schools/:schoolId/students/:studentId/charge-payments')
  recordPayment(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: RecordChargePaymentDto,
  ) {
    return this.charges.recordPayment(user.sub, schoolId, studentId, dto);
  }

  /** Refund a payment toward charges: to the card, given back in cash (records only) or as credit (Decision 338 item 3). Owner only. */
  @ApiCreatedResponse({ type: RecordChargePaymentResponseDto })
  @Post('schools/:schoolId/charge-payments/:transactionId/refund')
  refund(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body() dto: RefundChargePaymentDto,
  ) {
    return this.charges.refund(user.sub, schoolId, transactionId, dto);
  }

  /** Give the member credit, with a staff-only note (Decision 303 items 2 and 3). Owner only. */
  @ApiCreatedResponse({ type: ChargeBalancesResponseDto })
  @Post('schools/:schoolId/students/:studentId/credits')
  giveCredit(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: GiveCreditDto,
  ) {
    return this.charges.giveCredit(user.sub, schoolId, studentId, dto);
  }

  /** Send a charge's invoice notice again (Decision 338 item 5): whoever may create charges for the student. */
  @ApiCreatedResponse({ type: ResendInvoiceResponseDto })
  @Post('schools/:schoolId/charges/:chargeId/resend-invoice')
  resendInvoice(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('chargeId', ParseUUIDPipe) chargeId: string) {
    return this.charges.resendInvoice(user.sub, schoolId, chargeId);
  }

  /** The student's own charges and receipts at every School, for the student or their Guardian (the app). */
  @ApiOkResponse({ type: MemberChargesResponseDto })
  @Get('students/:id/charges')
  listForMember(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.charges.listForMember(user.sub, id);
  }

  /** Pay one charge, or the whole balance, by card in the app: a hosted Stripe Checkout (Decision 303 item 4). The student or their Guardian. */
  @ApiCreatedResponse({ type: ChargeCheckoutResponseDto })
  @Post('students/:id/charges/checkout')
  startCheckout(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartChargeCheckoutDto) {
    return this.charges.startCheckout(user.sub, id, dto);
  }

  /** "Pay charges automatically with my saved card" at one School (Decision 338 item 8). The member only; turning it on needs the X-Step-Up-Token header. */
  @ApiOkResponse({ type: ChargeAutoPayResponseDto })
  @ApiHeader({ name: 'x-step-up-token', required: false, description: 'Required only to turn it on (Decision 239) — from POST /auth/step-up/verify.' })
  @Put('students/:id/charge-auto-pay')
  setAutoPay(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetChargeAutoPayDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ) {
    return this.charges.setAutoPay(user.sub, id, dto, stepUpToken);
  }

  /** Branch Staff and coaches, with "Can create charges" and "Can cancel charges". Owner only. */
  @ApiOkResponse({ type: ChargePermissionListDto })
  @Get('schools/:schoolId/charge-permissions')
  listPermissions(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.charges.listPermissions(user.sub, schoolId);
  }

  @ApiOkResponse({ type: ChargePermissionDto })
  @Put('schools/:schoolId/charge-permissions/:userId')
  setPermission(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetChargePermissionDto,
  ) {
    return this.charges.setPermission(user.sub, schoolId, userId, dto);
  }
}
