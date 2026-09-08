import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RanksService } from './ranks.service';
import { CreateDisciplineDto } from './dto/create-discipline.dto';
import { UpdateDisciplineDto } from './dto/update-discipline.dto';
import { CreateRankDto } from './dto/create-rank.dto';
import { UpdateRankDto } from './dto/update-rank.dto';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
import { DisciplineListResponseDto, DisciplineResponseDto } from './dto/discipline-response.dto';
import { RankListResponseDto, RankResponseDto } from './dto/rank-response.dto';
import { SkillListResponseDto, SkillResponseDto } from './dto/skill-response.dto';

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
  @Get('schools/:schoolId/disciplines')
  async findAllDisciplines(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return { items: await this.ranksService.findAllDisciplines(user.sub, schoolId) };
  }

  @ApiOkResponse({ type: DisciplineResponseDto })
  @Get('disciplines/:id')
  findOneDiscipline(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ranksService.findOneDiscipline(user.sub, id);
  }

  @ApiOkResponse({ type: DisciplineResponseDto })
  @Patch('disciplines/:id')
  updateDiscipline(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateDisciplineDto) {
    return this.ranksService.updateDiscipline(user.sub, id, dto);
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
  @Get('styles/:disciplineId/ranks')
  async findAllRanks(@CurrentUser() user: JwtPayload, @Param('disciplineId') disciplineId: string) {
    return { items: await this.ranksService.findAllRanks(user.sub, disciplineId) };
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

  @ApiOkResponse({ type: SkillResponseDto })
  @Patch('skills/:id')
  updateSkill(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.ranksService.updateSkill(user.sub, id, dto);
  }
}
