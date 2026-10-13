import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
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
import { FavoriteListResponseDto, FavoriteResponseDto } from './dto/favorite-response.dto';
import { UpsertWatchProgressDto, WatchHistoryListResponseDto, WatchHistoryResponseDto } from './dto/watch-history.dto';
import {
  AddPlaylistItemDto,
  CreatePlaylistDto,
  PlaylistItemListResponseDto,
  PlaylistListResponseDto,
  PlaylistResponseDto,
  RenamePlaylistDto,
  ReorderPlaylistItemsDto,
} from './dto/playlist.dto';
import { CommentListResponseDto, CommentResponseDto, CreateCommentDto } from './dto/comment.dto';
import { VideoUploadUrlResponseDto } from './dto/video-upload-response.dto';

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
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean, description: 'Decision 226 — include archived Lessons too (excluded by default).' })
  @Get('schools/:schoolId/curriculum/lessons')
  async findLessonsForSchool(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean,
  ) {
    return { items: await this.curriculumService.findLessonsForSchool(user.sub, schoolId, includeArchived) };
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

  @ApiNoContentResponse({ description: 'Deleted (Decision 198). Owner only.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('lessons/:id')
  async deleteLesson(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.curriculumService.deleteLesson(user.sub, id);
  }

  @ApiOkResponse({ type: LessonResponseDto })
  @Patch('lessons/:id')
  updateLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.curriculumService.updateLesson(user.sub, id, dto);
  }

  /** Decision 226 — reversible alternative to deleteLesson() above, same
   * School-Owner gate. Idempotent, no dependents to block it today. */
  @ApiOkResponse({ type: LessonResponseDto })
  @Post('lessons/:id/archive')
  archiveLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.curriculumService.archiveLesson(user.sub, id);
  }

  @ApiOkResponse({ type: LessonResponseDto })
  @Post('lessons/:id/unarchive')
  unarchiveLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.curriculumService.unarchiveLesson(user.sub, id);
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

  // Curriculum learner-facing redesign (Decision 227/254): Favorite,
  // WatchHistory, Playlist/PlaylistItem, Comment, video upload.

  @ApiCreatedResponse({ type: FavoriteResponseDto })
  @Post('schools/:schoolId/curriculum/lessons/:id/favorite')
  addFavorite(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.curriculumService.addFavorite(user.sub, schoolId, id);
  }

  @ApiNoContentResponse({ description: 'Idempotent — a no-op if it wasn\'t favorited.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('schools/:schoolId/curriculum/lessons/:id/favorite')
  async removeFavorite(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.curriculumService.removeFavorite(user.sub, schoolId, id);
  }

  @ApiOkResponse({ type: FavoriteListResponseDto })
  @Get('schools/:schoolId/curriculum/favorites')
  findFavorites(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: PaginationQueryDto) {
    return this.curriculumService.findFavorites(user.sub, schoolId, query.cursor, query.limit);
  }

  @ApiCreatedResponse({ type: WatchHistoryResponseDto })
  @Post('schools/:schoolId/curriculum/lessons/:id/watch-progress')
  upsertWatchProgress(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertWatchProgressDto,
  ) {
    return this.curriculumService.upsertWatchProgress(user.sub, schoolId, id, dto);
  }

  @ApiOkResponse({ type: WatchHistoryListResponseDto })
  @Get('schools/:schoolId/curriculum/watch-history')
  findWatchHistory(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: PaginationQueryDto) {
    return this.curriculumService.findWatchHistory(user.sub, schoolId, query.cursor, query.limit);
  }

  @ApiCreatedResponse({ type: PlaylistResponseDto })
  @Post('curriculum/playlists')
  createPlaylist(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlaylistDto) {
    return this.curriculumService.createPlaylist(user.sub, dto);
  }

  @ApiOkResponse({ type: PlaylistListResponseDto })
  @Get('curriculum/playlists')
  findPlaylists(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.curriculumService.findPlaylists(user.sub, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: PlaylistResponseDto })
  @Patch('curriculum/playlists/:id')
  renamePlaylist(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenamePlaylistDto) {
    return this.curriculumService.renamePlaylist(user.sub, id, dto);
  }

  @ApiNoContentResponse({ description: 'Deleted; its PlaylistItems cascade away with it.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('curriculum/playlists/:id')
  async deletePlaylist(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.curriculumService.deletePlaylist(user.sub, id);
  }

  @ApiOkResponse({ type: PlaylistItemListResponseDto })
  @Get('curriculum/playlists/:id/items')
  findPlaylistItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.curriculumService.findPlaylistItems(user.sub, id);
  }

  @ApiCreatedResponse({ type: PlaylistItemListResponseDto })
  @Post('curriculum/playlists/:id/items')
  addPlaylistItem(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPlaylistItemDto) {
    return this.curriculumService.addPlaylistItem(user.sub, id, dto);
  }

  @ApiNoContentResponse({ description: 'Idempotent — a no-op if the item is already gone.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('curriculum/playlists/:id/items/:itemId')
  async removePlaylistItem(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    await this.curriculumService.removePlaylistItem(user.sub, id, itemId);
  }

  @ApiOkResponse({ type: PlaylistItemListResponseDto })
  @Put('curriculum/playlists/:id/items/order')
  reorderPlaylistItems(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderPlaylistItemsDto) {
    return this.curriculumService.reorderPlaylistItems(user.sub, id, dto);
  }

  @ApiCreatedResponse({ type: CommentResponseDto })
  @Post('schools/:schoolId/curriculum/lessons/:id/comments')
  createComment(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.curriculumService.createComment(user.sub, schoolId, id, dto);
  }

  @ApiOkResponse({ type: CommentListResponseDto })
  @Get('schools/:schoolId/curriculum/lessons/:id/comments')
  findComments(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.curriculumService.findComments(user.sub, schoolId, id, query.cursor, query.limit);
  }

  @ApiNoContentResponse({ description: 'Deleted — by its own author or School staff (Comment\'s own schema.prisma comment).' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('comments/:id')
  async deleteComment(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.curriculumService.deleteComment(user.sub, id);
  }

  /** Staff-gated — the service method does the actual check (requestVideoUploadUrl's
   * own assertStaffAtSchool/assertSchoolNotArchived), same convention as every
   * other write endpoint in this controller. */
  @ApiCreatedResponse({ type: VideoUploadUrlResponseDto })
  @Post('schools/:schoolId/curriculum/lessons/:id/video-upload-url')
  requestVideoUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.curriculumService.requestVideoUploadUrl(user.sub, schoolId, id);
  }
}
