import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ChargesService } from './charges.service';
import {
  CancelChargeDto,
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

/** Staff-created charges and the member balance, step 1 of 6 (v1.3 backlog
 * §3.6; Decisions 303, 338, 411). Paying in the app, recurring charges,
 * refunds and reports come in later steps. */
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

  /** The student's own charges and receipts at every School, for the student or their Guardian (the app). */
  @ApiOkResponse({ type: MemberChargesResponseDto })
  @Get('students/:id/charges')
  listForMember(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.charges.listForMember(user.sub, id);
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
