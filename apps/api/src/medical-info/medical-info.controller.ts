import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { MedicalInfoService } from './medical-info.service';
import { StudentMedicalInfoResponseDto } from './dto/medical-info.dto';

/** Decision 315 item 10: medical information given at sign-up. Staff only:
 * no member-facing endpoint returns it. */
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
}
