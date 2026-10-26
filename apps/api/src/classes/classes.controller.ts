import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { ClassListResponseDto, ClassResponseDto } from './dto/class-response.dto';
import { ClassesQueryDto } from './dto/classes-query.dto';

// Class CRUD this phase, plus archive()/unarchive() (Decision 226/252 — stale
// comment fixed: Class DOES have a real, reversible soft-archive mechanism now,
// just no hard-delete endpoint).
@ApiTags('classes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiCreatedResponse({ type: ClassResponseDto })
  @Post('schools/:schoolId/classes')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateClassDto,
  ) {
    return this.classesService.create(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: ClassListResponseDto })
  @Get('schools/:schoolId/classes')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: ClassesQueryDto,
  ) {
    return this.classesService.findAllForSchool(
      user.sub,
      schoolId,
      query.cursor,
      query.limit,
      query.activities,
      query.search,
      query.includeArchived,
      { disciplineId: query.disciplineId, startsFrom: query.startsFrom, startsTo: query.startsTo },
    );
  }

  @ApiOkResponse({ type: ClassResponseDto })
  @Get('classes/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.classesService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: ClassResponseDto })
  @Patch('classes/:id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateClassDto) {
    return this.classesService.update(user.sub, id, dto);
  }

  /** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by
   * an upcoming Booking or active WaitlistEntry. */
  @ApiOkResponse({ type: ClassResponseDto })
  @Post('classes/:id/archive')
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.classesService.archive(user.sub, id);
  }

  @ApiOkResponse({ type: ClassResponseDto })
  @Post('classes/:id/unarchive')
  unarchive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.classesService.unarchive(user.sub, id);
  }
}
