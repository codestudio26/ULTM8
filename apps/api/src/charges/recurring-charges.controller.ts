import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RecurringChargesService } from './recurring-charges.service';
import {
  CreateRecurringChargeDto,
  MemberRecurringChargesResponseDto,
  RecurringChargeResponseDto,
  StudentRecurringChargesResponseDto,
} from './dto/recurring-charge.dto';

/** Recurring charges outside a Membership Plan (v1.3 backlog §3.6 step 3;
 * Decision 303 item 1, Decision 338 item 2, Decision 412). */
@ApiTags('charges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RecurringChargesController {
  constructor(private readonly recurring: RecurringChargesService) {}

  /** A student's recurring charges: the owner, and staff who cover the student and may create, cancel or take payments. */
  @ApiOkResponse({ type: StudentRecurringChargesResponseDto })
  @Get('schools/:schoolId/students/:studentId/recurring-charges')
  listForStaff(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.recurring.listForStaff(user.sub, schoolId, studentId);
  }

  /** Set up a recurring charge: the owner, and staff with "Can create charges" who cover the student. */
  @ApiCreatedResponse({ type: RecurringChargeResponseDto })
  @Post('schools/:schoolId/students/:studentId/recurring-charges')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CreateRecurringChargeDto,
  ) {
    return this.recurring.create(user.sub, schoolId, studentId, dto);
  }

  /** Stop it: no more charges. The owner, and staff with "Can create charges" who cover the student. */
  @ApiCreatedResponse({ type: RecurringChargeResponseDto })
  @Post('schools/:schoolId/recurring-charges/:id/stop')
  stop(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.stop(user.sub, schoolId, id);
  }

  /** Restart a stopped one, from its next date on or after today. The owner, and staff with access to payments (Decision 338 item 2). */
  @ApiCreatedResponse({ type: RecurringChargeResponseDto })
  @Post('schools/:schoolId/recurring-charges/:id/restart')
  restart(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.restart(user.sub, schoolId, id);
  }

  /** The student's own recurring charges at every School, read-only, for the student or their Guardian (the app). */
  @ApiOkResponse({ type: MemberRecurringChargesResponseDto })
  @Get('students/:id/recurring-charges')
  listForMember(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.listForMember(user.sub, id);
  }
}
