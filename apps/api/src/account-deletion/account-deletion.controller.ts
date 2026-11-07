import { Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionStateDto } from './dto/account-deletion.dto';

/**
 * "Delete my account" (required by Apple before App Store submission). The
 * member previews what would happen, then asks, with a fresh step-up proof.
 * There is no cancel endpoint: signing in again within the 30 days cancels
 * (POST /auth/login answers `deletionCancelled: true`).
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me/deletion')
export class AccountDeletionController {
  constructor(private readonly accountDeletion: AccountDeletionService) {}

  @ApiOkResponse({ type: AccountDeletionStateDto })
  @Get()
  preview(@CurrentUser() user: JwtPayload) {
    return this.accountDeletion.preview(user.sub);
  }

  @ApiOkResponse({ type: AccountDeletionStateDto })
  @ApiHeader({ name: 'x-step-up-token', required: true, description: 'From POST /auth/step-up/verify.' })
  @HttpCode(200)
  @Post()
  request(@CurrentUser() user: JwtPayload, @Headers('x-step-up-token') stepUpToken?: string) {
    return this.accountDeletion.request(user.sub, stepUpToken);
  }
}
