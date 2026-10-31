import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RostersService } from './rosters.service';
import { AddRosterStudentsDto, RosterDto, RosterListDto, RosterNameDto, RosterStudentsDto } from './dto/roster.dto';

/** Rosters (Decision 317 item 6): named lists of members for staff. Staff
 * only: members never see them, so there is no `me` endpoint. */
@ApiTags('rosters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/rosters')
export class RostersController {
  constructor(private readonly rosters: RostersService) {}

  /** The School's rosters. Any staff at the School. */
  @ApiOkResponse({ type: RosterListDto })
  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.rosters.list(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: RosterDto })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: RosterNameDto) {
    return this.rosters.create(user.sub, schoolId, dto.name);
  }

  @ApiOkResponse({ type: RosterDto })
  @Patch(':rosterId')
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('rosterId', ParseUUIDPipe) rosterId: string,
    @Body() dto: RosterNameDto,
  ) {
    return this.rosters.rename(user.sub, schoolId, rosterId, dto.name);
  }

  /** Deletes the roster and takes everyone off it. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':rosterId')
  async remove(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('rosterId', ParseUUIDPipe) rosterId: string) {
    await this.rosters.remove(user.sub, schoolId, rosterId);
  }

  /** The current students on the roster that the caller covers (the Students
   * list's and roll call's roster filter). */
  @ApiOkResponse({ type: RosterStudentsDto })
  @Get(':rosterId/students')
  students(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('rosterId', ParseUUIDPipe) rosterId: string) {
    return this.rosters.students(user.sub, schoolId, rosterId);
  }

  @ApiOkResponse({ type: RosterStudentsDto })
  @HttpCode(200)
  @Post(':rosterId/students')
  add(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('rosterId', ParseUUIDPipe) rosterId: string,
    @Body() dto: AddRosterStudentsDto,
  ) {
    return this.rosters.addStudents(user.sub, schoolId, rosterId, dto.studentIds);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':rosterId/students/:studentId')
  async removeStudent(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('rosterId', ParseUUIDPipe) rosterId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    await this.rosters.removeStudent(user.sub, schoolId, rosterId, studentId);
  }
}
