import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

// GET/PATCH /users/me only this phase — DELETE /users/me (Decision 44) is deferred
// until the entities its account-deletion-processing job touches
// (WaiverSignature/StudentRank/Notification/Booking/Transaction/Membership) exist.
// See the Phase 6 kickoff prompt for the full scoping rationale.
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOkResponse({ type: UserResponseDto })
  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @ApiOkResponse({ type: UserResponseDto })
  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(user.sub, dto);
  }
}
