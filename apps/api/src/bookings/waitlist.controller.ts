import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { WaitlistService } from './waitlist.service';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { ClaimWaitlistDto } from './dto/claim-waitlist.dto';
import { WithdrawWaitlistQueryDto } from './dto/withdraw-waitlist-query.dto';
import { WaitlistEntryListResponseDto, WaitlistEntryResponseDto } from './dto/waitlist-entry-response.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

// Decision 17: extends the per-user/per-IP throttling already used on auth endpoints
// to waitlist-claim — see BookingsController's own BOOKING_ACTION_THROTTLE comment
// for the full rationale (identical shape, kept local to each controller the same
// way AuthController's own throttle constants are).
const WAITLIST_CLAIM_THROTTLE = { identity: { limit: 20, ttl: 60_000, getTracker: jwtSubTracker } };

@ApiTags('waitlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @ApiCreatedResponse({ type: WaitlistEntryResponseDto })
  @Post('classes/:id/waitlist')
  joinWaitlist(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: JoinWaitlistDto) {
    return this.waitlistService.joinWaitlist(user.sub, id, dto);
  }

  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('waitlist/:id')
  async withdraw(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query() query: WithdrawWaitlistQueryDto): Promise<void> {
    await this.waitlistService.withdraw(user.sub, id, query);
  }

  @ApiOkResponse({ type: BookingResponseDto })
  @Throttle(WAITLIST_CLAIM_THROTTLE)
  @Post('waitlist/:id/claim')
  claim(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ClaimWaitlistDto) {
    return this.waitlistService.claim(user.sub, id, dto);
  }

  @ApiOkResponse({ type: WaitlistEntryListResponseDto })
  @Get('classes/:id/waitlist')
  async findAllForClass(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return { items: await this.waitlistService.findAllForClass(user.sub, id) };
  }
}
