import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ChargeReportsService } from './charge-reports.service';
import { ChargeOverviewQueryDto, ChargeOverviewResponseDto, MemberBalancesResponseDto } from './dto/charge-report.dto';

/** The billing reports (Decision 338 item 11): the owner, and Branch Staff
 * the School lets record payments (their own branches' students). */
@ApiTags('charges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/charge-reports')
export class ChargeReportsController {
  constructor(private readonly reports: ChargeReportsService) {}

  @ApiOkResponse({ type: ChargeOverviewResponseDto })
  @Get('overview')
  overview(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: ChargeOverviewQueryDto) {
    return this.reports.overview(user.sub, schoolId, query.months ?? 12);
  }

  @ApiOkResponse({ type: MemberBalancesResponseDto })
  @Get('member-balances')
  memberBalances(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.reports.memberBalances(user.sub, schoolId);
  }
}
