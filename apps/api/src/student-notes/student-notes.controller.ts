import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StudentNotesService } from './student-notes.service';
import { CreateStudentNoteDto, MemberNoteListDto, MyStudentNotesQueryDto, StudentNoteDto, StudentNoteListDto, UpdateStudentNoteDto } from './dto/student-note.dto';

/** Staff notes on a student (backlog 3.10, Decision 400). */
@ApiTags('student-notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class StudentNotesController {
  constructor(private readonly notes: StudentNotesService) {}

  /** The notes shown to the caller (or their child), from every School. */
  @ApiOkResponse({ type: MemberNoteListDto })
  @Get('student-notes/me')
  mine(@CurrentUser() user: JwtPayload, @Query() query: MyStudentNotesQueryDto) {
    return this.notes.mine(user.sub, query.studentId);
  }

  /** Staff who cover the student: every note, newest first. */
  @ApiOkResponse({ type: StudentNoteListDto })
  @Get('schools/:schoolId/students/:studentId/notes')
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.notes.list(user.sub, schoolId, studentId);
  }

  @ApiCreatedResponse({ type: StudentNoteDto })
  @Post('schools/:schoolId/students/:studentId/notes')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CreateStudentNoteDto,
  ) {
    return this.notes.create(user.sub, schoolId, studentId, dto);
  }

  /** The note's author or a School owner. */
  @ApiOkResponse({ type: StudentNoteDto })
  @Patch('schools/:schoolId/students/:studentId/notes/:noteId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateStudentNoteDto,
  ) {
    return this.notes.update(user.sub, schoolId, studentId, noteId, dto);
  }

  /** The note's author or a School owner. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('schools/:schoolId/students/:studentId/notes/:noteId')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    await this.notes.remove(user.sub, schoolId, studentId, noteId);
  }
}
