import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { BookingsService } from './bookings.service';
import { BookClassDto } from './dto/book-class.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingOverrideDto } from './dto/update-booking-override.dto';
import { BookingListResponseDto, BookingResponseDto } from './dto/booking-response.dto';

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
  constructor(private readonly bookingsService: BookingsService) {}

  @ApiCreatedResponse({ type: BookingResponseDto })
  @Post('classes/:id/book')
  bookClass(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: BookClassDto) {
    return this.bookingsService.bookClass(user.sub, id, dto);
  }

  @ApiOkResponse({ type: BookingResponseDto })
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
