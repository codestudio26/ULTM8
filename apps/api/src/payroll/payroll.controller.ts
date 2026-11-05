import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PayRatesResponseDto, PayrollReportQueryDto, PayrollReportResponseDto, SetPayRateDto } from './dto/payroll.dto';
import { PayrollService } from './payroll.service';

/** The payroll report and the rates it uses (Decision 320 item 4). The
 * School's owners, and Branch Staff with the "Payroll" switch (Decision 435
 * item 22), for the whole School. */
@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @ApiOkResponse({ type: PayRatesResponseDto })
  @Get('rates')
  listRates(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.payroll.listRates(user.sub, schoolId);
  }

  @ApiOkResponse({ type: PayRatesResponseDto })
  @Put('rates/:userId')
  setRate(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetPayRateDto,
  ) {
    return this.payroll.setRate(user.sub, schoolId, userId, dto);
  }

  @ApiOkResponse({ type: PayrollReportResponseDto })
  @Get('report')
  report(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: PayrollReportQueryDto) {
    return this.payroll.report(user.sub, schoolId, query);
  }
}
