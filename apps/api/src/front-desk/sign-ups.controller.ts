import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { SignUpsService } from './sign-ups.service';
import {
  AcceptSignUpInviteDto,
  AcceptSignUpInviteResultDto,
  ApproveSignUpDto,
  ApproveSignUpResultDto,
  SignUpDto,
  SignUpInviteListDto,
  SignUpListDto,
  SignUpListQueryDto,
} from './dto/sign-up.dto';

/** Decision 392: sign-ups from the front-desk tablet, for staff to approve,
 * and the invites they send to an email that already has an account. */
@ApiTags('front-desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SignUpsController {
  constructor(private readonly signUps: SignUpsService) {}

  /** The owner, or Branch Staff with the students switch for their Branches. */
  @ApiOkResponse({ type: SignUpListDto })
  @Get('schools/:schoolId/sign-ups')
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: SignUpListQueryDto) {
    return this.signUps.list(user.sub, schoolId, query.view);
  }

  @ApiOkResponse({ type: ApproveSignUpResultDto })
  @HttpCode(200)
  @Post('schools/:schoolId/sign-ups/:id/approve')
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSignUpDto,
  ) {
    return this.signUps.approve(user.sub, schoolId, id, dto);
  }

  @ApiOkResponse({ type: SignUpDto })
  @HttpCode(200)
  @Post('schools/:schoolId/sign-ups/:id/reject')
  reject(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.signUps.reject(user.sub, schoolId, id);
  }

  /** The caller's own invites from Schools whose staff approved their sign-up. */
  @ApiOkResponse({ type: SignUpInviteListDto })
  @Get('sign-ups/invites/me')
  myInvites(@CurrentUser() user: JwtPayload) {
    return this.signUps.myInvites(user.sub);
  }

  @ApiCreatedResponse({ type: AcceptSignUpInviteResultDto })
  @Post('sign-ups/invites/:id/accept')
  accept(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptSignUpInviteDto) {
    return this.signUps.accept(user.sub, id, dto.branchId);
  }

  @HttpCode(204)
  @Post('sign-ups/invites/:id/decline')
  decline(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.signUps.decline(user.sub, id);
  }
}
