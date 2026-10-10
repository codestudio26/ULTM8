import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { InstructorBeltsService } from './instructor-belts.service';
import {
  DeclareInstructorBeltDto,
  InstructorBeltListResponseDto,
  InstructorBeltResponseDto,
  SchoolInstructorBeltsResponseDto,
  VerifyInstructorBeltDto,
} from './dto/instructor-belt.dto';

// Instructors' own belts (Decisions 108, 188): the instructor chooses, the
// School Owner verifies or corrects.
@ApiTags('ranks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class InstructorBeltsController {
  constructor(private readonly instructorBelts: InstructorBeltsService) {}

  @ApiOkResponse({ type: InstructorBeltListResponseDto })
  @Get('schools/:schoolId/instructor-belts/me')
  findMine(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.instructorBelts.findMine(user.sub, schoolId);
  }

  @ApiOkResponse({ type: InstructorBeltResponseDto })
  @Put('schools/:schoolId/instructor-belts/me/:disciplineId')
  declareMine(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: DeclareInstructorBeltDto,
  ) {
    return this.instructorBelts.declareMine(user.sub, schoolId, disciplineId, dto);
  }

  @ApiOkResponse({ type: SchoolInstructorBeltsResponseDto })
  @Get('schools/:schoolId/instructor-belts')
  findAll(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.instructorBelts.findAllForSchool(user.sub, schoolId);
  }

  @ApiOkResponse({ type: InstructorBeltResponseDto })
  @Post('schools/:schoolId/instructor-belts/:userId/:disciplineId/verify')
  verify(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('disciplineId', ParseUUIDPipe) disciplineId: string,
    @Body() dto: VerifyInstructorBeltDto,
  ) {
    return this.instructorBelts.verify(user.sub, schoolId, userId, disciplineId, dto);
  }
}
