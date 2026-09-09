import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FranchisesService } from './franchises.service';
import { CreateFranchiseDto } from './dto/create-franchise.dto';
import { UpdateFranchiseDto } from './dto/update-franchise.dto';
import { FranchiseListResponseDto, FranchiseResponseDto } from './dto/franchise-response.dto';
import { SchoolListResponseDto } from '../schools/dto/school-response.dto';

// Create / read / update only — no delete endpoint, same reasoning as SchoolsController
// (general tenant offboarding is [UNRESOLVED], ultm8-app-publishing §4).
@ApiTags('franchises')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('franchises')
export class FranchisesController {
  constructor(private readonly franchisesService: FranchisesService) {}

  @ApiCreatedResponse({ type: FranchiseResponseDto })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFranchiseDto) {
    return this.franchisesService.create(user.sub, dto);
  }

  @ApiOkResponse({ type: FranchiseListResponseDto })
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.franchisesService.findAllForCaller(user.sub, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: FranchiseResponseDto })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.franchisesService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: FranchiseResponseDto })
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateFranchiseDto) {
    return this.franchisesService.update(user.sub, id, dto);
  }

  /**
   * Franchise Owner's own School roster (ultm8-nestjs-module §5's confirmed
   * `GET /franchises/{id}/schools`) — see FranchisesService.findSchoolsForFranchise's
   * own header comment for the full "why this needs a cross-tenant read mechanism at
   * all" reasoning. Returns a plain array in the same items/nextCursor envelope every
   * other list endpoint uses (SchoolListResponseDto), with `nextCursor` always null
   * this phase — see that method's own comment on why cursor pagination isn't wired
   * up for this bounded roster view. No cast to the response DTO's shape, same as
   * every other controller method in this codebase (e.g. SchoolsController.findAll)
   * — `@ApiOkResponse` only drives Swagger/api-client generation, and Prisma's own
   * `School[]` already matches SchoolResponseDto structurally at the JSON-serialized
   * boundary (Date fields serialize to ISO strings automatically).
   */
  @ApiOkResponse({ type: SchoolListResponseDto })
  @Get(':id/schools')
  async findSchools(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const items = await this.franchisesService.findSchoolsForFranchise(user.sub, id);
    return { items, nextCursor: null };
  }
}
