import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxLineAmountDto } from '../../charges/dto/charge.dto';

/**
 * Field-for-field match of the Transaction Prisma model, plus three joined
 * fields: studentFirstName/studentSurname come from Transaction.student (a
 * User relation, resolved via resolveUserNames — see
 * TransactionsService.findAllForSchool); membershipPlanTitle comes from
 * Transaction.membershipPlan (a MembershipPlan relation, a plain Prisma
 * `include` — unlike the User-relation join above, MembershipPlan isn't
 * subject to the RoleGrant-revocation gotcha Decision 117 found, since a
 * School's own MembershipPlan rows are never revoked the way a Student's
 * RoleGrant can be).
 *
 * Shared by both the School Owner/Manager ledger read
 * (GET /schools/{id}/transactions) and the Student's own self-read
 * (GET /transactions/me) — the self-read never populates
 * studentFirstName/studentSurname (the caller already knows it's themselves,
 * same reasoning BookingsService.findMyBookings already established for
 * BookingListResponseDto), so those two fields are absent, not empty
 * strings, on that path's actual JSON response despite being typed
 * required here.
 */
/** Decision 431 (MON-6 step 1): the tax a membership price included. */
export class IncludedTaxDto {
  @ApiProperty({ description: 'The tax included, minor units (the lines added up).' })
  amount!: number;

  @ApiProperty({ type: () => TaxLineAmountDto, isArray: true })
  lines!: TaxLineAmountDto[];
}

export class TransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  studentFirstName!: string;

  @ApiProperty()
  studentSurname!: string;

  @ApiProperty()
  paymentAccountId!: string;

  /** Null only for a late-cancellation fee (Decision 346). */
  @ApiPropertyOptional({ type: String, nullable: true })
  membershipPlanId!: string | null;

  /** What this charge was for — added for the Student-facing self-read
   * (GET /transactions/me): the raw membershipPlanId alone doesn't tell a
   * Student what they paid for. Null for a late-cancellation fee, which names
   * its class in bookingClassTitle instead. */
  @ApiPropertyOptional({ type: String, nullable: true })
  membershipPlanTitle!: string | null;

  /** MEMBERSHIP (a plan bought or recorded at the desk), RENEWAL (a later
   * Subscription charge) or LATE_CANCEL_FEE (Decision 346). */
  @ApiProperty({ enum: ['MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE', 'FREEZE_FEE', 'CHARGE_PAYMENT'] })
  kind!: 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE' | 'FREEZE_FEE' | 'CHARGE_PAYMENT';

  /** CHARGE_PAYMENT only (Decision 338 item 9): the charge it was taken
   * against, as "#0000001 Rash guard"; null when it was paid toward the
   * balance as a whole. */
  @ApiPropertyOptional({ type: String, nullable: true })
  chargeId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  chargeDescription!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '#0000001' })
  chargeInvoiceLabel!: string | null;

  /** LATE_CANCEL_FEE only: the cancelled Booking and its class's title. */
  @ApiPropertyOptional({ type: String, nullable: true })
  bookingId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bookingClassTitle!: string | null;

  /** Set when School staff recorded this payment at the desk (Decision 346). */
  @ApiPropertyOptional({ type: String, nullable: true })
  recordedById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  membershipId!: string | null;

  @ApiProperty()
  billingDate!: string;

  @ApiProperty()
  amount!: number;

  /** Decision 406: the card surcharge paid on top of `amount`, same minor
   * units; 0 when none. Shown as its own line on the receipt. */
  @ApiProperty({ description: 'Card surcharge paid on top of amount, in the same minor units. 0 when none.' })
  surchargeAmount!: number;

  @ApiProperty({ description: 'Decision 435: the joining fee this first payment included, as part of amount (same minor units). 0 when none.' })
  joiningFeeAmount!: number;

  @ApiProperty({ description: 'Decision 435 item 5: whether that joining fee is refunded with the payment. A non-refundable one is always left out of refunds.' })
  joiningFeeRefundable!: boolean;

  @ApiPropertyOptional({
    type: () => IncludedTaxDto,
    nullable: true,
    description:
      "Decision 431 (MON-6 step 1): for a membership sale or renewal, the tax its price included, worked out with the School's tax settings (or the member's home Branch's) when it was paid. Null when no tax applied, when the School's prices have tax added on top (membership prices aren't taxed on top yet), or for a payment from before this was recorded.",
  })
  includedTax!: IncludedTaxDto | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  paymentMethod!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  disputedAmount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  refundedAmount!: number | null;

  /** Decision 338 item 1: when a Pending cash or bank-transfer payment was
   * cancelled. Its status stays FAILED; screens show it as Cancelled
   * (Decision 414 item 7). */
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Set when the payment was cancelled: shown as Cancelled (status stays FAILED).' })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only; null in the member\'s own list.' })
  cancelledById!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Who cancelled it. Staff only; null in the member\'s own list.' })
  cancelledByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Why it was cancelled. Staff only; never sent to the member.' })
  cancelReason!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "Decision 316 item 10: the income category of the plan (a plan purchase or renewal) or of the charge (a payment toward a charge) this payment is for, as it is now. Staff only; null in the member's own list, and for fees that belong to neither.",
  })
  incomeCategoryName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class TransactionListResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  items!: TransactionResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}

/** GET /transactions/{id}/invoice — see TransactionsService's own header
 * comment. `null` is a real, normal state (CASH/BANK_TRANSFER payment, or a
 * Stripe PaymentIntent with no receipt yet), not an error. */
export class TransactionReceiptUrlResponseDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Stripe\'s own hosted receipt page. Null if this Transaction was not paid via Stripe, or Stripe has no receipt for it yet.' })
  receiptUrl!: string | null;
}

export class TransactionRevenueDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty({ description: 'Minor units.' })
  amount!: number;
}

/** GET /schools/{id}/transactions/summary (Decision 339) — the Transactions
 * page's tiles, counted over the whole ledger. */
export class TransactionSummaryResponseDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  successful!: number;

  @ApiProperty()
  pending!: number;

  @ApiProperty({ description: 'Failed (not cancelled) or disputed.' })
  failedOrDisputed!: number;

  @ApiProperty({ description: 'Cancelled cash or bank-transfer payments (Decision 338 item 1).' })
  cancelled!: number;

  @ApiProperty({ type: [TransactionRevenueDto], description: 'Successful rows only, one entry per currency.' })
  revenue!: TransactionRevenueDto[];
}
