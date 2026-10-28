import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { RemoveFromSchoolDto, RemoveFromSchoolResponseDto, StaffTeachingResponseDto } from '../role-grants/dto/staff-list.dto';
import { StaffRemovalService } from './staff-removal.service';

/** Decision 361 — the Staff page's "Remove from School". See StaffRemovalService. */
@ApiTags('role-grants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class StaffRemovalController {
  constructor(private readonly staffRemoval: StaffRemovalService) {}

  /** What the person still teaches here, for the Remove dialog. */
  @ApiOkResponse({ type: StaffTeachingResponseDto })
  @Get('schools/:schoolId/staff/:userId/teaching')
  teaching(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('userId') userId: string) {
    return this.staffRemoval.teaching(user.sub, schoolId, userId);
  }

  @ApiCreatedResponse({ type: RemoveFromSchoolResponseDto })
  @Post('schools/:schoolId/staff/:userId/remove')
  removeFromSchool(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('userId') userId: string,
    @Body() dto: RemoveFromSchoolDto,
  ) {
    return this.staffRemoval.remove(user.sub, schoolId, userId, dto);
  }
}
