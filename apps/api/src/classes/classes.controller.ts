import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { ClassListResponseDto, ClassResponseDto } from './dto/class-response.dto';

// Class CRUD only this phase — no booking/waitlist, no TimetableSlot materialization.
// See the Phase 4 kickoff prompt for the full scoping rationale. No delete endpoint,
// same reasoning as School/Branch (general tenant offboarding is [UNRESOLVED]).
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
    @Query() query: PaginationQueryDto,
  ) {
    return this.classesService.findAllForSchool(user.sub, schoolId, query.cursor, query.limit);
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
}
