import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { TransactionsService } from './transactions.service';
import { TransactionListResponseDto, TransactionReceiptUrlResponseDto, TransactionSummaryResponseDto } from './dto/transaction-response.dto';

// Staff-facing School ledger + the Student's own self-read. No route-ordering
// conflict between 'transactions/me' and the Staff route below — different
// path shapes ('schools/:schoolId/transactions' vs 'transactions/me'), same
// non-issue BookingsController's own comment already notes for 'bookings/me'.
// 'transactions/:id/invoice' (added later) is a different path SHAPE again
// (3 segments vs. 'transactions/me's 2) — no ordering hazard with 'me' the way
// WaiversController's bare 'waivers/me' vs 'waivers/:id' has, since NestJS
// matches by full path shape, not just the first segment.
@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @ApiOkResponse({ type: TransactionListResponseDto })
  @Get('schools/:schoolId/transactions')
  findAllForSchool(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.transactionsService.findAllForSchool(user.sub, schoolId, query.cursor, query.limit);
  }

  /** The page's tiles, counted over the whole ledger (Decision 339). */
  @ApiOkResponse({ type: TransactionSummaryResponseDto })
  @Get('schools/:schoolId/transactions/summary')
  summaryForSchool(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.transactionsService.summaryForSchool(user.sub, schoolId);
  }

  /** Student-scoped transaction history / receipt viewing — closes the
   * TRACK-B-ROADMAP.md "Explicitly blocked" gap of the same name. See
   * TransactionsService's own header comment for scope/RLS. */
  @ApiOkResponse({ type: TransactionListResponseDto })
  @Get('transactions/me')
  findMyTransactions(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.transactionsService.findMyTransactions(user.sub, query.cursor, query.limit);
  }

  /** Spec 55 §7's own confirmed `GET /transactions/{id}/invoice (download)` —
   * see TransactionsService.getReceiptUrl's own header comment. */
  @ApiOkResponse({ type: TransactionReceiptUrlResponseDto })
  @Get('transactions/:id/invoice')
  getReceiptUrl(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.getReceiptUrl(user.sub, id);
  }
}
