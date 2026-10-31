import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { MemberFilesService, type UploadedMemberFile } from './member-files.service';
import { MemberFileDownloadDto, MemberFileDto, MemberFileListDto, UploadMemberFileDto } from './dto/member-file.dto';
import { MEMBER_FILE_MAX_BYTES } from './member-file-type';

/**
 * Files on a member (backlog 5.11, Decision 315 item 9). Staff-side only: the
 * School's owners and Branch Staff with "See and manage member files". There
 * is deliberately no member-facing route.
 */
@ApiTags('member-files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/students/:studentId/files')
export class MemberFilesController {
  constructor(private readonly files: MemberFilesService) {}

  /** The student's files, newest first. */
  @ApiOkResponse({ type: MemberFileListDto })
  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.files.list(user.sub, schoolId, studentId);
  }

  /** Upload one PDF, JPG or PNG (multipart field "file", up to 10 MB). The
   * parser stops reading at its limit and answers 413; it treats a file that
   * reaches the limit as cut off, so the limit is one byte above 10 MB. */
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadMemberFileDto })
  @ApiCreatedResponse({ type: MemberFileDto })
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEMBER_FILE_MAX_BYTES + 1, files: 1, fields: 0 } }))
  upload(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @UploadedFile() file: UploadedMemberFile | undefined,
  ) {
    return this.files.upload(user.sub, schoolId, studentId, file);
  }

  /** A link that downloads the file for the next 5 minutes. */
  @ApiOkResponse({ type: MemberFileDownloadDto })
  @Get(':fileId/download')
  download(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    return this.files.downloadUrl(user.sub, schoolId, studentId, fileId);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':fileId')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    await this.files.remove(user.sub, schoolId, studentId, fileId);
  }
}
