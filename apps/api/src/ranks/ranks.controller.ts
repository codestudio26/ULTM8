import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RanksService } from './ranks.service';
import { CreateDisciplineDto } from './dto/create-discipline.dto';
import { UpdateDisciplineDto } from './dto/update-discipline.dto';
import { CreateRankDto } from './dto/create-rank.dto';
import { UpdateRankDto } from './dto/update-rank.dto';
import { ReorderRanksDto, ReorderSkillsDto, RungHoldersResponseDto } from './dto/ladder.dto';
import { CreateStyleFromTemplateDto, StyleTemplateListResponseDto } from './dto/style-template.dto';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
import { DisciplineListResponseDto, DisciplineResponseDto } from './dto/discipline-response.dto';
import { RankListResponseDto, RankResponseDto } from './dto/rank-response.dto';
import { SkillListResponseDto, SkillResponseDto } from './dto/skill-response.dto';
import { BeltColoursResponseDto, SaveBeltColoursDto } from './dto/belt-colours.dto';

// Discipline/Rank/Skill catalog CRUD only this controller — grading actions
// (promote/downgrade/stripe-award/skill-signoff) and StudentRank reads live in
// GradingController. See RanksService's own header comment for scoping.
@ApiTags('ranks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RanksController {
  constructor(private readonly ranksService: RanksService) {}

  // ---- Discipline (Developer-level addition — see CreateDisciplineDto's own
  // comment: Spec 55 never names how a Discipline itself gets created) ----

  @ApiCreatedResponse({ type: DisciplineResponseDto })
  @Post('schools/:schoolId/disciplines')
  createDiscipline(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: CreateDisciplineDto) {
    return this.ranksService.createDiscipline(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: DisciplineListResponseDto })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, description: 'Decision 309 — include archived styles too (left out by default).' })
  @Get('schools/:schoolId/disciplines')
  async findAllDisciplines(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean,
  ) {
    return { items: await this.ranksService.findAllDisciplines(user.sub, schoolId, includeArchived) };
  }

  @ApiOkResponse({ type: StyleTemplateListResponseDto })
  @Get('style-templates')
  listTemplates() {
    return this.ranksService.listTemplates();
  }

  @ApiCreatedResponse({ type: DisciplineResponseDto, description: 'The new style, built from the template (Decisions 131, 182).' })
  @Post('schools/:schoolId/disciplines/from-template')
  createFromTemplate(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: CreateStyleFromTemplateDto) {
    return this.ranksService.createFromTemplate(user.sub, schoolId, dto);
  }

  @ApiCreatedResponse({ type: DisciplineResponseDto, description: 'The copy, named "… (Copy)" (Decision 182).' })
  @Post('disciplines/:id/duplicate')
  duplicateDiscipline(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ranksService.duplicateDiscipline(user.sub, id);
  }

  @ApiOkResponse({ type: DisciplineResponseDto })
  @Get('disciplines/:id')
  findOneDiscipline(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ranksService.getDiscipline(user.sub, id);
  }

  @ApiOkResponse({ type: DisciplineResponseDto })
  @Patch('disciplines/:id')
  updateDiscipline(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateDisciplineDto) {
    return this.ranksService.updateDiscipline(user.sub, id, dto);
  }

  /** Decision 309 — retire a style: hidden from pickers, read-only, history
   * kept. Refused (409) while an upcoming class or a timetable slot uses it. */
  @ApiOkResponse({ type: DisciplineResponseDto })
  @ApiConflictResponse({ description: 'An upcoming class or a timetable slot still uses the style.' })
  @Post('disciplines/:id/archive')
  archiveDiscipline(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ranksService.archiveDiscipline(user.sub, id);
  }

  @ApiOkResponse({ type: DisciplineResponseDto })
  @Post('disciplines/:id/unarchive')
  unarchiveDiscipline(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ranksService.unarchiveDiscipline(user.sub, id);
  }

  @ApiNoContentResponse({ description: 'Deleted (Decision 198).' })
  @ApiConflictResponse({ description: 'The style is in use: someone holds a rank in it, or classes, slots or lessons use it.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('disciplines/:id')
  async deleteDiscipline(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.ranksService.deleteDiscipline(user.sub, id);
  }

  // ---- Backlog 3.18: the School's saved belt colours ----

  @ApiOkResponse({ type: BeltColoursResponseDto })
  @Get('schools/:schoolId/belt-colours')
  findBeltColours(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.ranksService.findBeltColours(user.sub, schoolId);
  }

  @ApiOkResponse({ type: BeltColoursResponseDto, description: 'The whole list, as saved.' })
  @Put('schools/:schoolId/belt-colours')
  saveBeltColours(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: SaveBeltColoursDto) {
    return this.ranksService.saveBeltColours(user.sub, schoolId, dto);
  }

  // ---- Rank — confirmed route literal is "/styles/{id}/ranks" (Spec 55 §7);
  // "styles" and "disciplineId" refer to the same Discipline resource, see
  // domain-rules §16's own terminology table. ----

  @ApiCreatedResponse({ type: RankResponseDto })
  @Post('styles/:disciplineId/ranks')
  createRank(@CurrentUser() user: JwtPayload, @Param('disciplineId') disciplineId: string, @Body() dto: CreateRankDto) {
    return this.ranksService.createRank(user.sub, disciplineId, dto);
  }

  @ApiOkResponse({ type: RankListResponseDto })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, description: 'Decision 226 — include archived belts too (excluded by default).' })
  @Get('styles/:disciplineId/ranks')
  async findAllRanks(
    @CurrentUser() user: JwtPayload,
    @Param('disciplineId') disciplineId: string,
    @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean,
  ) {
    return { items: await this.ranksService.findAllRanks(user.sub, disciplineId, includeArchived) };
  }

  @ApiOkResponse({ type: RankListResponseDto, description: 'The style\'s belts in their new order.' })
  @Put('styles/:disciplineId/ranks/order')
  async reorderRanks(@CurrentUser() user: JwtPayload, @Param('disciplineId') disciplineId: string, @Body() dto: ReorderRanksDto) {
    return { items: await this.ranksService.reorderRanks(user.sub, disciplineId, dto) };
  }

  @ApiOkResponse({ type: RungHoldersResponseDto })
  @Get('styles/:disciplineId/rung-holders')
  findRungHolders(@CurrentUser() user: JwtPayload, @Param('disciplineId') disciplineId: string) {
    return this.ranksService.findRungHolders(user.sub, disciplineId);
  }

  @ApiOkResponse({ type: RankResponseDto })
  @Get('ranks/:id')
  findOneRank(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ranksService.findOneRank(user.sub, id);
  }

  @ApiOkResponse({ type: RankResponseDto })
  @Patch('ranks/:id')
  updateRank(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateRankDto) {
    return this.ranksService.updateRank(user.sub, id, dto);
  }

  @ApiNoContentResponse({ description: 'Deleted (Decision 198).' })
  @ApiConflictResponse({ description: 'Someone holds the belt, or it is in grading history.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('ranks/:id')
  async deleteRank(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.ranksService.deleteRank(user.sub, id);
  }

  /** Decision 226 — reversible alternative to deleteRank() above, same
   * School-Owner gate and "safe to remove" rule. Idempotent, blocked (409)
   * by the identical holders/history/declared conditions. */
  @ApiOkResponse({ type: RankResponseDto })
  @ApiConflictResponse({ description: 'Someone holds the belt, it is in grading history, or an instructor has declared it.' })
  @Post('ranks/:id/archive')
  archiveRank(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ranksService.archiveRank(user.sub, id);
  }

  @ApiOkResponse({ type: RankResponseDto })
  @Post('ranks/:id/unarchive')
  unarchiveRank(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ranksService.unarchiveRank(user.sub, id);
  }

  // ---- Skill — nested under the same Discipline resource; no dedicated route
  // literal given in Spec 55's own §7 table beyond "PATCH /students/{id}/
  // skills/{skillId}" for sign-off cycling (GradingController) — CRUD itself is
  // a Developer-level addition, same class as Discipline's own CRUD above. ----

  @ApiCreatedResponse({ type: SkillResponseDto })
  @Post('styles/:disciplineId/skills')
  createSkill(@CurrentUser() user: JwtPayload, @Param('disciplineId') disciplineId: string, @Body() dto: CreateSkillDto) {
    return this.ranksService.createSkill(user.sub, disciplineId, dto);
  }

  @ApiOkResponse({ type: SkillListResponseDto })
  @Get('styles/:disciplineId/skills')
  async findAllSkills(@CurrentUser() user: JwtPayload, @Param('disciplineId') disciplineId: string) {
    return { items: await this.ranksService.findAllSkills(user.sub, disciplineId) };
  }

  @ApiOkResponse({ type: SkillListResponseDto, description: 'The style\'s skills in their new order (Decision 309).' })
  @Put('styles/:disciplineId/skills/order')
  async reorderSkills(@CurrentUser() user: JwtPayload, @Param('disciplineId', ParseUUIDPipe) disciplineId: string, @Body() dto: ReorderSkillsDto) {
    return { items: await this.ranksService.reorderSkills(user.sub, disciplineId, dto) };
  }

  @ApiOkResponse({ type: SkillResponseDto })
  @Patch('skills/:id')
  updateSkill(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.ranksService.updateSkill(user.sub, id, dto);
  }

  @ApiNoContentResponse({ description: 'Deleted (Decision 198).' })
  @ApiConflictResponse({ description: 'Students have been marked on the skill, or it is a lesson\'s only skill.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('skills/:id')
  async deleteSkill(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.ranksService.deleteSkill(user.sub, id);
  }
}
