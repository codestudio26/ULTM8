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
import { JoinSchoolResponseDto } from './dto/join-school-response.dto';
import { JoinSchoolDto } from './dto/join-school.dto';
import { JoinFranchiseDto } from './dto/join-franchise.dto';
import { StudentListResponseDto } from './dto/student-summary-response.dto';

// Create / read / update only — no delete endpoint (general tenant offboarding is
// [UNRESOLVED], ultm8-app-publishing §4 — not ultm8-domain-rules §2, which is about
// Franchise/School/Branch organisational structure, not offboarding; corrected here
// after this same miscitation was found copied across four files).
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

  /** The Student roster — Staff-only, see SchoolsService.findAllStudentsForSchool. */
  @ApiOkResponse({ type: StudentListResponseDto })
  @Get(':id/students')
  findStudents(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findAllStudentsForSchool(user.sub, id);
  }

  @ApiCreatedResponse({ type: JoinSchoolResponseDto })
  @Post(':id/join')
  join(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: JoinSchoolDto) {
    return this.schoolsService.join(user.sub, id, dto);
  }

  /** School Owner/Manager only — see SchoolsService.joinFranchise's own header
   * comment for the full "narrow, one-way only" account (Phase 16b-i, Decision 98). */
  @ApiCreatedResponse({ type: SchoolResponseDto })
  @Post(':id/join-franchise')
  joinFranchise(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: JoinFranchiseDto) {
    return this.schoolsService.joinFranchise(user.sub, id, dto.franchiseId);
  }
}
