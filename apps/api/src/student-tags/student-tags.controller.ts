import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StudentTagsService } from './student-tags.service';
import { AddStudentTagDto, SchoolTagDto, SchoolTagListDto, SchoolTagNameDto, StudentTagListDto, TaggedStudentsDto } from './dto/student-tag.dto';

/** Tags on students (backlog 5.4, Decision 315 item 7). Staff only: members
 * never see their tags, so there is no `me` endpoint. */
@ApiTags('student-tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId')
export class StudentTagsController {
  constructor(private readonly tags: StudentTagsService) {}

  /** The School's tag list. Any staff at the School. */
  @ApiOkResponse({ type: SchoolTagListDto })
  @Get('student-tags')
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.tags.listTags(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: SchoolTagDto })
  @Post('student-tags')
  create(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: SchoolTagNameDto) {
    return this.tags.createTag(user.sub, schoolId, dto.name);
  }

  @ApiOkResponse({ type: SchoolTagDto })
  @Patch('student-tags/:tagId')
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Body() dto: SchoolTagNameDto,
  ) {
    return this.tags.renameTag(user.sub, schoolId, tagId, dto.name);
  }

  /** Deletes the tag and takes it off every student. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('student-tags/:tagId')
  async remove(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('tagId', ParseUUIDPipe) tagId: string) {
    await this.tags.deleteTag(user.sub, schoolId, tagId);
  }

  /** The students with this tag that the caller covers (the Students list's tag filter). */
  @ApiOkResponse({ type: TaggedStudentsDto })
  @Get('student-tags/:tagId/students')
  tagged(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('tagId', ParseUUIDPipe) tagId: string) {
    return this.tags.taggedStudents(user.sub, schoolId, tagId);
  }

  @ApiOkResponse({ type: StudentTagListDto })
  @Get('students/:studentId/tags')
  studentTags(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.tags.studentTags(user.sub, schoolId, studentId);
  }

  /** Tag the student; `name` adds a new tag to the School's list first. */
  @ApiOkResponse({ type: StudentTagListDto })
  @HttpCode(200)
  @Post('students/:studentId/tags')
  add(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: AddStudentTagDto,
  ) {
    return this.tags.addToStudent(user.sub, schoolId, studentId, dto);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('students/:studentId/tags/:tagId')
  async untag(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ) {
    await this.tags.removeFromStudent(user.sub, schoolId, studentId, tagId);
  }
}
