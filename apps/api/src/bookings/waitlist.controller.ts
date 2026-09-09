import { Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { WaitlistService } from './waitlist.service';
import { WaitlistEntryResponseDto } from './dto/waitlist-entry-response.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

@ApiTags('waitlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @ApiCreatedResponse({ type: WaitlistEntryResponseDto })
  @Post('classes/:id/waitlist')
  joinWaitlist(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.waitlistService.joinWaitlist(user.sub, id);
  }

  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('waitlist/:id')
  async withdraw(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.waitlistService.withdraw(user.sub, id);
  }

  @ApiOkResponse({ type: BookingResponseDto })
  @Post('waitlist/:id/claim')
  claim(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.waitlistService.claim(user.sub, id);
  }
}
