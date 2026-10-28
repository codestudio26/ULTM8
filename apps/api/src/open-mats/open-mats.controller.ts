import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { OpenMatsService } from './open-mats.service';
import {
  MyOpenMatPermissionDto,
  OpenMatPermissionDto,
  OpenMatPermissionListDto,
  OpenMatStartedDto,
  SetOpenMatPermissionDto,
  StartOpenMatDto,
} from './dto/open-mat.dto';

/** Unplanned open mat sessions (Decision 386, front-desk handover F10). */
@ApiTags('open-mats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/open-mats')
export class OpenMatsController {
  constructor(private readonly openMats: OpenMatsService) {}

  @ApiCreatedResponse({ type: OpenMatStartedDto })
  @Post()
  start(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: StartOpenMatDto) {
    return this.openMats.start(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: MyOpenMatPermissionDto })
  @Get('me')
  mine(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.openMats.mine(user.sub, schoolId);
  }

  @ApiOkResponse({ type: OpenMatPermissionListDto })
  @Get('permissions')
  listPermissions(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.openMats.listPermissions(user.sub, schoolId);
  }

  @ApiOkResponse({ type: OpenMatPermissionDto })
  @Put('permissions/:userId')
  setPermission(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetOpenMatPermissionDto,
  ) {
    return this.openMats.setPermission(user.sub, schoolId, userId, dto.canStartOpenMat);
  }
}
