import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { MemberMergeService } from './member-merge.service';
import { MergeDuplicateDto, MergeDuplicateQueryDto, MergePreviewDto, MergeResultDto } from './dto/member-merge.dto';

/**
 * Merge duplicate members (Decision 315 item 13). The student in the path is
 * the record that is kept; `duplicateId` is merged into it. School owners
 * only. Only this School's records move; the duplicate's account and login
 * are not changed.
 */
@ApiTags('member-merge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/students/:studentId/merge')
export class MemberMergeController {
  constructor(private readonly merges: MemberMergeService) {}

  /** What merging `duplicateId` into this student would move, and anything that stops it. Changes nothing. */
  @ApiOkResponse({ type: MergePreviewDto })
  @Get('preview')
  preview(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: MergeDuplicateQueryDto,
  ) {
    return this.merges.preview(user.sub, schoolId, studentId, query.duplicateId);
  }

  /** Merge `duplicateId` into this student. 409 MERGE_BLOCKED when the preview lists a reason. */
  @ApiCreatedResponse({ type: MergeResultDto })
  @Post()
  merge(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() body: MergeDuplicateDto,
  ) {
    return this.merges.merge(user.sub, schoolId, studentId, body.duplicateId);
  }
}
