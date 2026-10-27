import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchListResponseDto, BranchResponseDto } from './dto/branch-response.dto';
import { BranchesQueryDto } from './dto/branches-query.dto';
import { BranchClosePreviewDto, CloseBranchDto } from './dto/close-branch.dto';

@ApiTags('branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @ApiCreatedResponse({ type: BranchResponseDto })
  @Post('schools/:schoolId/branches')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchesService.create(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: BranchListResponseDto })
  @Get('schools/:schoolId/branches')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: BranchesQueryDto,
  ) {
    return this.branchesService.findAllForSchool(user.sub, schoolId, query);
  }

  @ApiOkResponse({ type: BranchResponseDto })
  @Get('branches/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.branchesService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: BranchResponseDto })
  @Patch('branches/:id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(user.sub, id, dto);
  }

  /** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by
   * anything still in use (Decision 330). A close with nothing to move. */
  @ApiOkResponse({ type: BranchResponseDto })
  @Post('branches/:id/archive')
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.branchesService.archive(user.sub, id);
  }

  /** Decision 330 — what closing this Branch would move. Owner only. */
  @ApiOkResponse({ type: BranchClosePreviewDto })
  @Get('branches/:id/close-preview')
  closePreview(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.branchesService.closePreview(user.sub, id);
  }

  /** Decision 330 — move what is still in use, then archive. Owner only,
   * idempotent. See BranchesService.close. */
  @ApiOkResponse({ type: BranchResponseDto })
  @Post('branches/:id/close')
  close(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CloseBranchDto) {
    return this.branchesService.close(user.sub, id, dto);
  }

  @ApiOkResponse({ type: BranchResponseDto })
  @Post('branches/:id/unarchive')
  unarchive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.branchesService.unarchive(user.sub, id);
  }
}
