import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiProperty({ enum: ['MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE'] })
  kind!: 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE';

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

  @ApiProperty()
  failedOrDisputed!: number;

  @ApiProperty({ type: [TransactionRevenueDto], description: 'Successful rows only, one entry per currency.' })
  revenue!: TransactionRevenueDto[];
}
