import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { StudentAccessService } from './student-access.service';
import {
  AcceptChildInviteResponseDto,
  AddChildManuallyDto,
  AddChildManuallyResponseDto,
  ChildInviteListDto,
  NewTemporaryPasscodeResponseDto,
  TemporaryPasscodeStatusDto,
} from './dto/student-access.dto';

/** Same tier as the other Add manually routes: each makes accounts. */
const ADD_MANUALLY_THROTTLE = { identity: { limit: 20, ttl: 3_600_000, getTracker: jwtSubTracker } };

/** App access for a new student (backlog 3.3, Decision 403). */
@ApiTags('student-access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class StudentAccessController {
  constructor(private readonly access: StudentAccessService) {}

  /** The owner adds a child and names their Guardian. */
  @ApiCreatedResponse({ type: AddChildManuallyResponseDto })
  @Throttle(ADD_MANUALLY_THROTTLE)
  @Post('schools/:schoolId/students/add-child-manually')
  addChildManually(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: AddChildManuallyDto) {
    return this.access.addChildManually(user.sub, schoolId, dto);
  }

  /** Invites still waiting for the Guardian to accept. Owner only. */
  @ApiOkResponse({ type: ChildInviteListDto })
  @Get('schools/:schoolId/child-invites')
  listChildInvites(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.access.listChildInvites(user.sub, schoolId);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Post('schools/:schoolId/child-invites/:id/withdraw')
  async withdrawChildInvite(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.withdrawChildInvite(user.sub, schoolId, id);
  }

  /** The Guardian's invites to add a child. */
  @ApiOkResponse({ type: ChildInviteListDto })
  @Get('child-invites/me')
  myChildInvites(@CurrentUser() user: JwtPayload) {
    return this.access.myChildInvites(user.sub);
  }

  @ApiCreatedResponse({ type: AcceptChildInviteResponseDto })
  @Post('child-invites/:id/accept')
  acceptChildInvite(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.access.acceptChildInvite(user.sub, id);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Post('child-invites/:id/decline')
  async declineChildInvite(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.declineChildInvite(user.sub, id);
  }

  /** Whether a new temporary passcode can be made for this student (or for a
   * child, their Guardian). Owner only. */
  @ApiOkResponse({ type: TemporaryPasscodeStatusDto })
  @Get('schools/:schoolId/students/:studentId/temporary-passcode')
  temporaryPasscodeStatus(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.access.temporaryPasscodeStatus(user.sub, schoolId, studentId);
  }

  @ApiCreatedResponse({ type: NewTemporaryPasscodeResponseDto })
  @Throttle(ADD_MANUALLY_THROTTLE)
  @Post('schools/:schoolId/students/:studentId/temporary-passcode')
  newTemporaryPasscode(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.access.newTemporaryPasscode(user.sub, schoolId, studentId);
  }
}
