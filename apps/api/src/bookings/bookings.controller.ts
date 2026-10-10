import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { GuardiansService } from '../guardians/guardians.service';
import { BookingsService } from './bookings.service';
import { BookClassDto } from './dto/book-class.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingOverrideDto } from './dto/update-booking-override.dto';
import { BookingListResponseDto, BookingResponseDto } from './dto/booking-response.dto';

// Decision 17: extends the per-user/per-IP throttling already used on auth endpoints
// to class-booking and credit-restore (cancelBooking is where BookingsService restores
// a membership credit — see its own restoreCredit()) — a volumetric-abuse risk
// distinct from BookingsService's own atomicity/race-condition handling. The `default`
// (per-IP) throttler already applies globally (app.module.ts); this adds the
// previously entirely-missing per-user half, keyed by the caller's JWT `sub`.
const BOOKING_ACTION_THROTTLE = { identity: { limit: 20, ttl: 60_000, getTracker: jwtSubTracker } };

// Booking creation/cancellation/override + the caller's own read. See
// BookingsService's own header comment for scope/RLS. `GET /bookings/me` has no
// route-ordering conflict with the `/bookings/:id/...` routes below (different HTTP
// methods and path shapes), unlike the `/waivers/me` vs `/waivers/:id` case Phase 10
// had to order carefully.
@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly guardiansService: GuardiansService,
  ) {}

  /**
   * Decision 123 — JwtStrategy.validate() already rejects a Kid-Mode token on
   * every request shape except exactly this one (right path/method, body
   * studentId matching the token's own kidMode.studentId, no overrideReason).
   * That check alone is still only a claim-shape gate, not a live authorization
   * decision — `await this.guardiansService.assertBookingDelegationActive(...)`
   * here is the actual "never trust the JWT claim alone" re-check (same
   * discipline assertGuardianOfStudent() already established), run fresh on
   * every single call rather than cached from mint time.
   */
  @ApiCreatedResponse({ type: BookingResponseDto })
  @Throttle(BOOKING_ACTION_THROTTLE)
  @Post('classes/:id/book')
  async bookClass(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: BookClassDto) {
    if (user.kidMode) {
      await this.guardiansService.assertBookingDelegationActive(user.sub, user.kidMode.studentId);
    }
    return this.bookingsService.bookClass(user.sub, id, dto, Boolean(user.kidMode));
  }

  @ApiOkResponse({ type: BookingResponseDto })
  @Throttle(BOOKING_ACTION_THROTTLE)
  @Patch('bookings/:id/cancel')
  cancelBooking(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CancelBookingDto) {
    return this.bookingsService.cancelBooking(user.sub, id, dto);
  }

  @ApiOkResponse({ type: BookingResponseDto })
  @Patch('bookings/:id/override')
  updateOverrideReason(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBookingOverrideDto) {
    return this.bookingsService.updateOverrideReason(user.sub, id, dto);
  }

  @ApiOkResponse({ type: BookingListResponseDto })
  @Get('bookings/me')
  findMyBookings(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.bookingsService.findMyBookings(user.sub, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: BookingListResponseDto })
  @Get('classes/:id/bookings')
  findAllForClass(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.bookingsService.findAllForClass(user.sub, id, query.cursor, query.limit);
  }
}
