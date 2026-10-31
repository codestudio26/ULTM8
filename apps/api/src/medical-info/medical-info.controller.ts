import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { MedicalInfoService } from './medical-info.service';
import { MedicalInfoSharedListDto, StudentMedicalInfoResponseDto } from './dto/medical-info.dto';

/** Decision 315 item 10: medical information given at sign-up. Only staff
 * read the text. Decision 419 item 1: the member (the Guardian for a child)
 * can withdraw consent, which deletes it. */
@ApiTags('medical-info')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/students/:studentId/medical-info')
export class MedicalInfoController {
  constructor(private readonly medicalInfo: MedicalInfoService) {}

  /** The School's owners, and Branch Staff with "See medical information"
   * for the students of their own branches. */
  @ApiOkResponse({ type: StudentMedicalInfoResponseDto })
  @Get()
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.medicalInfo.getForStaff(user.sub, schoolId, studentId);
  }

  /** Withdraw consent (Decision 419 item 1): the member when an adult, or the
   * Guardian for a child; never the child, never staff. Deletes the medical
   * information this School holds at once. 404 when it holds none. */
  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete()
  async withdraw(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    await this.medicalInfo.withdraw(user.sub, schoolId, studentId);
  }
}

/** Decision 419 item 1: which Schools hold medical information about a
 * member. For the member (an adult) or the Guardian for a child. */
@ApiTags('medical-info')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('students/:studentId/medical-info')
export class MemberMedicalInfoController {
  constructor(private readonly medicalInfo: MedicalInfoService) {}

  /** Presence and the date consent was given, per School; never the text. */
  @ApiOkResponse({ type: MedicalInfoSharedListDto })
  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.medicalInfo.listShared(user.sub, studentId);
  }
}
