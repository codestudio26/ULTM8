import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GrowthService } from './growth.service';
import { GrowthQueryDto, GrowthResponseDto } from './dto/growth.dto';

/** Students → Growth (backlog 5.8): the owner sees the whole School, Branch
 * Staff with "See attendance statistics" their own Branches' students. */
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class GrowthController {
  constructor(private readonly growthService: GrowthService) {}

  /** Active, Visitors and Frozen now; new and cancelled per month and new per
   * style over the last 12 months, in the School's time zone. */
  @ApiOkResponse({ type: GrowthResponseDto })
  @Get('schools/:schoolId/growth')
  growth(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: GrowthQueryDto) {
    return this.growthService.growth(user.sub, schoolId, query);
  }
}
