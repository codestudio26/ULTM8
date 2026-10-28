import { Body, Controller, ExecutionContext, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { bookingTracker, isStaffBookingOnBehalf, jwtSubTracker } from '../common/throttle/identity-trackers';
import { GuardiansService } from '../guardians/guardians.service';
import { BookingsService } from './bookings.service';
import { BookClassDto } from './dto/book-class.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingOverrideDto } from './dto/update-booking-override.dto';
import { BookingListResponseDto, BookingResponseDto } from './dto/booking-response.dto';
import { MinorBookingListDto, MinorSchoolListDto } from './dto/minor-bookings.dto';
import { StudentBookingListResponseDto, StudentNextBookingResponseDto } from './dto/student-booking-response.dto';
import { BookingsSummaryQueryDto } from './dto/bookings-summary-query.dto';
import { BookingsSummaryResponseDto } from './dto/bookings-summary-response.dto';
import { CancellationService } from './cancellation.service';
import { CancelClassDto } from './dto/cancel-class.dto';
import { ResolveCancellationDto } from './dto/resolve-cancellation.dto';
import { OpenCancellationResponseDto } from './dto/open-cancellation-response.dto';
import { ClassResponseDto } from '../classes/dto/class-response.dto';

// Decision 17: extends the per-user/per-IP throttling already used on auth endpoints
// to class-booking and credit-restore (cancelBooking is where BookingsService restores
// a membership credit — see its own restoreCredit()) — a volumetric-abuse risk
// distinct from BookingsService's own atomicity/race-condition handling. The `default`
// (per-IP) throttler already applies globally (app.module.ts); this adds the
// previously entirely-missing per-user half, keyed by the caller's JWT `sub`.
const BOOKING_ACTION_THROTTLE = { identity: { limit: 20, ttl: 60_000, getTracker: jwtSubTracker } };

// Booking itself: the same 20 a minute for a Student's (or Guardian's) own
// bookings, but 200 a minute, counted separately, for a staff member booking on
// someone's behalf (product owner, 28 Oct 2026: a front desk at a busy class hit
// 20). See isStaffBookingOnBehalf. The per-IP `default` throttler still applies.
const BOOK_CLASS_THROTTLE = {
  identity: {
    ttl: 60_000,
    limit: (context: ExecutionContext) => (isStaffBookingOnBehalf(context.switchToHttp().getRequest()) ? 200 : 20),
    getTracker: bookingTracker,
  },
};

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
    private readonly cancellationService: CancellationService,
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
  @Throttle(BOOK_CLASS_THROTTLE)
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

  /** Decision 379 — a parent books a class for their child in the app: the
   * child's Schools and upcoming bookings. Booking and cancelling reuse the
   * Guardian-on-behalf-of paths (BookClassDto/CancelBookingDto.studentId). */
  @ApiOkResponse({ type: MinorSchoolListDto })
  @Get('guardians/me/minors/:studentId/schools')
  findMinorSchools(@CurrentUser() user: JwtPayload, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.bookingsService.findMinorSchools(user.sub, studentId);
  }

  @ApiOkResponse({ type: MinorBookingListDto })
  @Get('guardians/me/minors/:studentId/bookings')
  findMinorBookings(@CurrentUser() user: JwtPayload, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.bookingsService.findMinorUpcomingBookings(user.sub, studentId);
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

  /** The student page's "Upcoming booking": the soonest one and how many more
   * (Decision 341) — see BookingsService.findNextForStudent. Declared before
   * the list route below only for reading order; the paths don't overlap. */
  @ApiOkResponse({ type: StudentNextBookingResponseDto })
  @Get('students/:id/bookings/next')
  findNextForStudent(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('schoolId') schoolId: string,
  ) {
    return this.bookingsService.findNextForStudent(user.sub, id, schoolId);
  }

  /** v1.2 backend backlog — Student Detail's "Upcoming Booking", a real
   * per-Student Staff read. `schoolId` required query param, same convention
   * as GET /students/{id}/membership-status and /students/{id}/rank-history
   * — see BookingsService.findAllForStudent's own header comment. */
  @ApiOkResponse({ type: StudentBookingListResponseDto })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor from the previous page.' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Get('students/:id/bookings')
  findAllForStudent(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('schoolId') schoolId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.bookingsService.findAllForStudent(user.sub, id, schoolId, cursor, limit);
  }

  /** v1.2 backend backlog — Dashboard "Bookings This Week" drill-down. School
   * Owner only since Decision 367. See
   * BookingsService.getWeeklySummary's own header comment for the date-range
   * default/validation and the two disclosed judgment calls on grouping. */
  @ApiOkResponse({ type: BookingsSummaryResponseDto })
  @Get('schools/:schoolId/bookings/summary')
  getWeeklySummary(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Query() query: BookingsSummaryQueryDto) {
    return this.bookingsService.getWeeklySummary(user.sub, schoolId, query.from, query.to, query.branchId);
  }

  /** Decision 291 — the School cancels a whole class. School Owner/Manager or
   * that branch's Branch Staff. See CancellationService.cancelClass. */
  @ApiOkResponse({ type: ClassResponseDto })
  @Post('classes/:id/cancel')
  cancelClass(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelClassDto) {
    return this.cancellationService.cancelClass(user.sub, id, dto.reason);
  }

  /** Decision 291 — the staff "to resolve" list. See CancellationService.listOpen. */
  @ApiOkResponse({ type: [OpenCancellationResponseDto] })
  @Get('schools/:schoolId/cancellations')
  listOpenCancellations(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.cancellationService.listOpen(user.sub, schoolId);
  }

  /** Decision 291 — a staff decision on one seat in that list. */
  @ApiOkResponse({ type: BookingResponseDto })
  @Throttle(BOOKING_ACTION_THROTTLE)
  @Patch('bookings/:id/resolution')
  resolveCancellation(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveCancellationDto) {
    return this.cancellationService.resolve(user.sub, id, dto.attendeeId, dto.action);
  }
}
