import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SchoolListResponseDto, SchoolResponseDto } from './dto/school-response.dto';

// Create / read / update only — no delete endpoint (general tenant offboarding is
// [UNRESOLVED], ultm8-domain-rules §2/ultm8-app-publishing §4).
@ApiTags('schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @ApiCreatedResponse({ type: SchoolResponseDto })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSchoolDto) {
    return this.schoolsService.create(user.sub, dto);
  }

  @ApiOkResponse({ type: SchoolListResponseDto })
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.schoolsService.findAllForCaller(user.sub, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: SchoolResponseDto })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: SchoolResponseDto })
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSchoolDto) {
    return this.schoolsService.update(user.sub, id, dto);
  }
}
