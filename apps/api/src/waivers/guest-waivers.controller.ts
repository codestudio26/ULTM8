import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { GuestWaiversService } from './guest-waivers.service';
import {
  BookingGuestsDto,
  ClassGuestWaiversDto,
  FriendPassListDto,
  GuestWaiverPageDto,
  GuestWaiverSignatureDetailDto,
  GuestWaiverSignatureListDto,
  SignGuestWaiversDto,
  SignGuestWaiversResponseDto,
} from './dto/guest-waiver.dto';

// The signing page has no sign-in, so it is limited per IP, tighter than the
// app-wide default. A link token is 256 bits, so this is defence in depth.
const GUEST_PAGE_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const GUEST_SIGN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** The guest waiver signing page (Waivers Q9): public, the link is the key. */
@ApiTags('guest-waivers')
@Controller('guest-waiver-links')
export class GuestWaiverLinksController {
  constructor(private readonly guestWaivers: GuestWaiversService) {}

  @Throttle(GUEST_PAGE_THROTTLE)
  @ApiOkResponse({ type: GuestWaiverPageDto })
  @Get(':token')
  page(@Param('token') token: string) {
    return this.guestWaivers.page(token);
  }

  @Throttle(GUEST_SIGN_THROTTLE)
  @ApiOkResponse({ type: SignGuestWaiversResponseDto })
  @HttpCode(200)
  @Post(':token/sign')
  sign(@Param('token') token: string, @Body() dto: SignGuestWaiversDto) {
    return this.guestWaivers.sign(token, dto);
  }
}

/** Guests' waivers for the booker and staff, and the booker's Friend Passes. */
@ApiTags('guest-waivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class GuestWaiversController {
  constructor(private readonly guestWaivers: GuestWaiversService) {}

  @ApiOkResponse({ type: BookingGuestsDto })
  @Get('bookings/:id/guests')
  bookingGuests(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.guestWaivers.bookingGuests(user.sub, id);
  }

  @ApiOkResponse({ type: ClassGuestWaiversDto })
  @Get('classes/:id/guest-waivers')
  classGuests(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.guestWaivers.classGuests(user.sub, id);
  }

  @ApiOkResponse({ type: FriendPassListDto })
  @Get('schools/:schoolId/friend-passes/me')
  myFriendPasses(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.guestWaivers.myFriendPasses(user.sub, schoolId);
  }

  @ApiOkResponse({ type: GuestWaiverSignatureListDto })
  @Get('schools/:schoolId/waivers/:id/guest-signatures')
  listSignatures(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.guestWaivers.listSignatures(user.sub, schoolId, id, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: GuestWaiverSignatureDetailDto })
  @Get('schools/:schoolId/waivers/:id/guest-signatures/:signatureId')
  getSignature(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('signatureId', ParseUUIDPipe) signatureId: string,
  ) {
    return this.guestWaivers.getSignature(user.sub, schoolId, id, signatureId);
  }
}
