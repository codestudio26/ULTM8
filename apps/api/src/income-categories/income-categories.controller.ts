import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { IncomeCategoriesService } from './income-categories.service';
import { IncomeCategoryDto, IncomeCategoryListDto, IncomeCategoryNameDto } from './dto/income-category.dto';

/** The School's income categories (Decision 316 item 10). Staff only; the
 * owner manages the list. */
@ApiTags('income-categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/income-categories')
export class IncomeCategoriesController {
  constructor(private readonly categories: IncomeCategoriesService) {}

  /** Any staff at the School. */
  @ApiOkResponse({ type: IncomeCategoryListDto })
  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.categories.list(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: IncomeCategoryDto })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: IncomeCategoryNameDto) {
    return this.categories.create(user.sub, schoolId, dto.name);
  }

  @ApiOkResponse({ type: IncomeCategoryDto })
  @Patch(':categoryId')
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: IncomeCategoryNameDto,
  ) {
    return this.categories.rename(user.sub, schoolId, categoryId, dto.name);
  }

  /** Only a category no plan or charge uses. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':categoryId')
  async remove(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('categoryId', ParseUUIDPipe) categoryId: string) {
    await this.categories.remove(user.sub, schoolId, categoryId);
  }
}
