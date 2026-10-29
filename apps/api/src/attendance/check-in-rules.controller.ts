import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CheckInRulesService } from './check-in-rules.service';
import { CheckInRulesDto } from './dto/check-in-rules.dto';

/** A School's check-in rules (Decision 394, handover F9). */
@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/check-in-rules')
export class CheckInRulesController {
  constructor(private readonly rules: CheckInRulesService) {}

  /** Owners, and Branch Staff with "Change check-in rules". */
  @ApiOkResponse({ type: CheckInRulesDto })
  @Get()
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.rules.get(user.sub, schoolId);
  }

  /** Every rule at once, as the Settings form saves them. */
  @ApiOkResponse({ type: CheckInRulesDto })
  @Put()
  update(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CheckInRulesDto) {
    return this.rules.update(user.sub, schoolId, dto);
  }
}
