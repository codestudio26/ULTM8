import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurriculumService } from './curriculum.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { LessonListResponseDto, LessonResponseDto } from './dto/lesson-response.dto';
import {
  LessonCategoryListResponseDto,
  LessonCategoryNameDto,
  LessonCategoryResponseDto,
  OrderCategoryLessonsDto,
  OrderLessonCategoriesDto,
} from './dto/lesson-category.dto';

/**
 * `/schools/:schoolId/curriculum/lessons` for create+list is a Developer-level
 * route addition (same class as Discipline/Skill's own CRUD — see
 * CreateSkillDto's own comment): Spec 55's own §7 table names
 * `CRUD /admin/curriculum/lessons`, which this project resolved directly with the
 * user as a spec-internal contradiction against Decision 58's own "an instructor
 * uploads" (see Lesson's schema.prisma comment, Decision 104) — tenant-side, not
 * Platform Admin, so this controller lives under the ordinary JwtAuthGuard, not
 * PlatformAdminJwtAuthGuard. `GET /skills/:id/lessons` and `GET /lessons/:id`
 * are Spec 55's own literal confirmed routes, unchanged.
 */
@ApiTags('curriculum')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CurriculumController {
  constructor(private readonly curriculumService: CurriculumService) {}

  @ApiCreatedResponse({ type: LessonResponseDto })
  @Post('schools/:schoolId/curriculum/lessons')
  createLesson(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: CreateLessonDto) {
    return this.curriculumService.createLesson(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: LessonListResponseDto })
  @Get('schools/:schoolId/curriculum/lessons')
  async findLessonsForSchool(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return { items: await this.curriculumService.findLessonsForSchool(user.sub, schoolId) };
  }

  @ApiOkResponse({ type: LessonListResponseDto })
  @Get('skills/:id/lessons')
  async findLessonsForSkill(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return { items: await this.curriculumService.findLessonsForSkill(user.sub, id) };
  }

  @ApiOkResponse({ type: LessonResponseDto })
  @Get('lessons/:id')
  findOneLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.curriculumService.findOneLesson(user.sub, id);
  }

  @ApiOkResponse({ type: LessonResponseDto })
  @Patch('lessons/:id')
  updateLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.curriculumService.updateLesson(user.sub, id, dto);
  }

  // Lesson categories (Decisions 128.15, 191).

  @ApiOkResponse({ type: LessonCategoryListResponseDto })
  @Get('schools/:schoolId/curriculum/categories')
  findCategories(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.curriculumService.findCategories(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: LessonCategoryResponseDto })
  @Post('schools/:schoolId/curriculum/categories')
  createCategory(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: LessonCategoryNameDto) {
    return this.curriculumService.createCategory(user.sub, schoolId, dto.name);
  }

  @ApiOkResponse({ type: LessonCategoryResponseDto })
  @Patch('curriculum/categories/:id')
  renameCategory(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LessonCategoryNameDto) {
    return this.curriculumService.renameCategory(user.sub, id, dto.name);
  }

  @ApiOkResponse({ type: LessonCategoryListResponseDto })
  @Put('schools/:schoolId/curriculum/categories/order')
  orderCategories(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: OrderLessonCategoriesDto) {
    return this.curriculumService.orderCategories(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: LessonListResponseDto })
  @Put('curriculum/categories/:id/lessons/order')
  orderCategoryLessons(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderCategoryLessonsDto) {
    return this.curriculumService.orderCategoryLessons(user.sub, id, dto);
  }

  /** The lessons a student may watch, for the student or their guardian
   * (Decisions 154, 190, 195); the others come back locked. */
  @ApiOkResponse({ type: LessonListResponseDto })
  @Get('students/:id/lessons')
  async findLessonsForStudent(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Query('schoolId') schoolId: string) {
    return { items: await this.curriculumService.findLessonsForStudent(user.sub, id, schoolId) };
  }
}
