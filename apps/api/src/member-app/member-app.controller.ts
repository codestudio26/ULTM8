import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isProfileLocked, switchesForMember } from './member-app-switches';
import { MemberAppSettingsResponseDto } from './dto/member-app.dto';

/**
 * Decision 318 item 7: what the student app may show this member, from the
 * switches of their own Schools (and their children's). The app hides what a
 * School turned off; the API refuses it on its own, whatever the app shows.
 */
@ApiTags('member-app')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MemberAppController {
  constructor(private readonly prismaJobs: PrismaJobsService) {}

  @ApiOkResponse({ type: MemberAppSettingsResponseDto })
  @Get('member-app/me')
  async mySettings(@CurrentUser() user: JwtPayload): Promise<MemberAppSettingsResponseDto> {
    const [profileLocked, schools] = await Promise.all([isProfileLocked(this.prismaJobs, user.sub), switchesForMember(this.prismaJobs, user.sub)]);
    return { profileLocked, schools };
  }
}
