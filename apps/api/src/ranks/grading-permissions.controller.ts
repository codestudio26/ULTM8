import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GradingPermissionsService } from './grading-permissions.service';
import { GradingPermissionListResponseDto, MyGradingPermissionsResponseDto, SetGradingPermissionsDto } from './dto/grading-permission.dto';

// Grading permission per discipline (Decision 138). School owner only, except
// "mine" (Decision 184): any staff member's own.
@ApiTags('ranks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class GradingPermissionsController {
  constructor(private readonly gradingPermissionsService: GradingPermissionsService) {}

  @ApiOkResponse({ type: MyGradingPermissionsResponseDto })
  @Get('schools/:schoolId/grading-permissions/me')
  findMine(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.gradingPermissionsService.findMine(user.sub, schoolId);
  }

  @ApiOkResponse({ type: GradingPermissionListResponseDto })
  @Get('schools/:schoolId/grading-permissions')
  findAll(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.gradingPermissionsService.findAllForSchool(user.sub, schoolId);
  }

  @ApiOkResponse({ type: GradingPermissionListResponseDto })
  @Put('schools/:schoolId/grading-permissions/:userId')
  setForUser(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('userId') userId: string,
    @Body() dto: SetGradingPermissionsDto,
  ) {
    return this.gradingPermissionsService.setForUser(user.sub, schoolId, userId, dto);
  }
}
