import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { FranchiseFeesService } from './franchise-fees.service';
import { RefundFranchiseFeeChargeDto } from './dto/refund-franchise-fee-charge.dto';
import { FranchiseFeeChargeListResponseDto, FranchiseFeeChargeResponseDto } from './dto/franchise-fee-charge-response.dto';

/**
 * Read-only history (both tenant sides, RLS-scoped) + the Franchise-Owner-only
 * refund action (Spec 55 §10.2) — no create endpoint at all. Rows are created
 * exclusively by FranchiseFeeBillingService (the franchise-fee-usage-reporting
 * job) and stripe-webhook-processing's own invoice.paid/invoice.payment_failed
 * handlers, never by a caller directly, so there is no `POST
 * /franchise-fee-charges` to build.
 */
@ApiTags('franchise-fees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FranchiseFeesController {
  constructor(private readonly franchiseFeesService: FranchiseFeesService) {}

  @ApiOkResponse({ type: FranchiseFeeChargeListResponseDto })
  @Get('franchises/:id/fee-charges')
  findAllForFranchise(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.franchiseFeesService.findAllForFranchise(user.sub, id, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: FranchiseFeeChargeListResponseDto })
  @Get('schools/:id/fee-charges')
  findAllForSchool(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.franchiseFeesService.findAllForSchool(user.sub, id, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: FranchiseFeeChargeResponseDto })
  @Get('franchise-fee-charges/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.franchiseFeesService.findOne(user.sub, id);
  }

  /** Franchise Owner only — see FranchiseFeesService.refund()'s own header
   * comment for the full account. */
  @ApiCreatedResponse({ type: FranchiseFeeChargeResponseDto })
  @Post('franchise-fee-charges/:id/refund')
  refund(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RefundFranchiseFeeChargeDto) {
    return this.franchiseFeesService.refund(user.sub, id, dto.amount);
  }
}
