import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DashboardService } from './dashboard.service';
import { BirthdaysResponseDto, DashboardOverviewDto, UpdateSetupChecklistDto } from './dto/dashboard.dto';

/** Decision 374 — Active students, setup checklist (School Owner) and this
 * week's birthdays (all staff). */
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOkResponse({ type: DashboardOverviewDto })
  @Get('schools/:schoolId/dashboard')
  getOverview(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.dashboardService.getOverview(user.sub, schoolId);
  }

  @ApiOkResponse({ type: DashboardOverviewDto })
  @Patch('schools/:schoolId/dashboard/setup-checklist')
  setSetupChecklistHidden(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Body() dto: UpdateSetupChecklistDto,
  ) {
    return this.dashboardService.setSetupChecklistHidden(user.sub, schoolId, dto.hidden);
  }

  @ApiOkResponse({ type: BirthdaysResponseDto })
  @Get('schools/:schoolId/birthdays')
  getBirthdays(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.dashboardService.getBirthdays(user.sub, schoolId);
  }
}
