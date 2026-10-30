import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { MAX_CHARGE_MINOR } from '../charge-maths';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const CHARGE_STATUSES = ['OPEN', 'PART_PAID', 'PAID', 'CANCELLED'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Decision 338 item 9: how money was taken at the desk. */
export const DESK_CHARGE_PAYMENT_METHODS = ['CASH', 'PIX', 'BANK_TRANSFER', 'CARD_TERMINAL'] as const;
export type DeskChargePaymentMethod = (typeof DESK_CHARGE_PAYMENT_METHODS)[number];

/** How a payment toward charges was made: a desk method, or STRIPE (a card in
 * the app, or the saved card charged automatically; backlog §3.6 step 2). */
export const CHARGE_PAYMENT_METHODS = [...DESK_CHARGE_PAYMENT_METHODS, 'STRIPE'] as const;
export type ChargePaymentMethod = (typeof CHARGE_PAYMENT_METHODS)[number];

/** Transaction.chargePaymentChannel (step 2). */
export const CHARGE_PAYMENT_CHANNELS = ['DESK', 'APP', 'AUTOMATIC'] as const;
export type ChargePaymentChannelValue = (typeof CHARGE_PAYMENT_CHANNELS)[number];

export const CHARGE_PAYMENT_STATUSES = ['SUCCESSFUL', 'PENDING', 'FAILED', 'REFUNDED', 'DISPUTED'] as const;
export type ChargePaymentStatus = (typeof CHARGE_PAYMENT_STATUSES)[number];

/** Step 4 (Decision 338 item 3): a charge or payment refunded in full or in part. */
export const REFUND_STATUSES = ['REFUNDED', 'PART_REFUNDED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** ChargeRefund.kind. The owner picks CARD, MONEY_BACK or CREDIT; DISPUTE_LOST
 * and STRIPE come from Stripe's webhooks. */
export const CHARGE_REFUND_KINDS = ['CARD', 'MONEY_BACK', 'CREDIT', 'DISPUTE_LOST', 'STRIPE'] as const;
export const CHARGE_REFUND_DESTINATIONS = ['CARD', 'MONEY_BACK', 'CREDIT'] as const;
export type ChargeRefundDestination = (typeof CHARGE_REFUND_DESTINATIONS)[number];

/** POST /schools/{schoolId}/students/{studentId}/charges (Decision 303). */
export class CreateChargeDto {
  @ApiProperty({ maxLength: 200, example: 'Rash guard' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @ApiProperty({ description: "The price in minor units of the School's currency, as the School prices (with or without tax, by its tax setting).", minimum: 1, maximum: MAX_CHARGE_MINOR })
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  amount!: number;

  @ApiPropertyOptional({ enum: ['PERCENT', 'FIXED'], nullable: true })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsIn(['PERCENT', 'FIXED'])
  discountType?: 'PERCENT' | 'FIXED' | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'PERCENT: hundredths of a percent (1250 = 12.5%). FIXED: minor units. Required with discountType.' })
  @ValidateIf((o: CreateChargeDto) => !!o.discountType)
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  discountValue?: number | null;

  @ApiProperty({ example: '2026-11-15', description: 'The due date (YYYY-MM-DD).' })
  @Matches(DAY, { message: 'dueDate must be a date like 2026-11-15.' })
  @IsISO8601({ strict: true }, { message: 'dueDate must be a date like 2026-11-15.' })
  dueDate!: string;
}

/** POST /schools/{schoolId}/charges/{chargeId}/cancel (Decision 338 item 1). */
export class CancelChargeDto {
  @ApiPropertyOptional({ maxLength: 500, description: "For staff only. Required unless the School's owner made it optional." })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** POST /schools/{schoolId}/students/{studentId}/charge-payments (Decision 338 item 9). */
export class RecordChargePaymentDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'The charge it was taken for. Null or missing: toward the balance, oldest charge first.' })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID()
  chargeId?: string | null;

  @ApiProperty({ minimum: 1, maximum: MAX_CHARGE_MINOR, description: 'Minor units. More than is owed becomes credit; less leaves the rest owed.' })
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  amount!: number;

  @ApiProperty({ enum: DESK_CHARGE_PAYMENT_METHODS })
  @IsIn(DESK_CHARGE_PAYMENT_METHODS)
  paymentMethod!: DeskChargePaymentMethod;

  @ApiPropertyOptional({ default: true, description: 'Send the member (or Guardian) a notification with the receipt.' })
  @IsOptional()
  @IsBoolean()
  sendReceipt?: boolean;
}

/** PUT /schools/{schoolId}/charge-permissions/{userId}. */
export class SetChargePermissionDto {
  @ApiProperty()
  @IsBoolean()
  canCreateCharges!: boolean;

  @ApiProperty()
  @IsBoolean()
  canCancelCharges!: boolean;
}

export class ChargeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty({ description: 'The running number per School.' })
  invoiceNumber!: number;

  @ApiProperty({ example: '#0000001' })
  invoiceLabel!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: 'The price as typed, before the discount.' })
  unitAmount!: number;

  @ApiPropertyOptional({ enum: ['PERCENT', 'FIXED'], nullable: true })
  discountType!: 'PERCENT' | 'FIXED' | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  discountValue!: number | null;

  @ApiProperty()
  discountAmount!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  taxCountry!: string | null;

  @ApiProperty({ description: 'Hundredths of a percent, as when the charge was created.' })
  taxRateBasisPoints!: number;

  @ApiProperty()
  taxInclusive!: boolean;

  @ApiProperty({ description: 'The price excluding tax.' })
  netAmount!: number;

  @ApiProperty()
  taxAmount!: number;

  @ApiProperty({ description: 'The price including tax: what is owed.' })
  grossAmount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ example: '2026-11-15' })
  dueDate!: string;

  @ApiProperty({ description: 'Paid so far (by desk payments and credit).' })
  paidAmount!: number;

  @ApiProperty({ description: 'Still to pay; 0 once paid or cancelled.' })
  owedAmount!: number;

  @ApiProperty({ enum: CHARGE_STATUSES })
  status!: ChargeStatus;

  @ApiProperty({ description: 'Something is still owed and the due date has passed.' })
  overdue!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  createdByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  cancelledByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only; never sent to the member.' })
  cancelReason!: string | null;

  @ApiProperty({ description: "Decision 406: the card surcharge on what is still owed when paid by card in the app (0 = none). Member's view only; 0 for staff." })
  cardSurchargeAmount!: number;

  @ApiPropertyOptional({ type: () => LateFeeDetailsDto, nullable: true, description: 'Decision 413: set when this charge is a late fee, with what it is for.' })
  lateFee!: LateFeeDetailsDto | null;

  @ApiPropertyOptional({
    type: () => PromotionFeeChargeDetailsDto,
    nullable: true,
    description: 'Backlog §3.6 step 6 (Decision 303 item 5): set when this charge is an accepted promotion fee, with the grade it is for.',
  })
  promotionFee!: PromotionFeeChargeDetailsDto | null;

  @ApiProperty({ description: 'Step 4 (Decision 338 item 3): refunded off its total, to the card, in cash or as credit. A refund never re-opens a charge.' })
  refundedAmount!: number;

  @ApiPropertyOptional({ enum: REFUND_STATUSES, enumName: 'RefundStatus', nullable: true, description: 'Refunded in full, in part, or not at all (null).' })
  refundStatus!: RefundStatus | null;
}

/** One refund of a payment (step 4). */
export class ChargeRefundResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CHARGE_REFUND_KINDS, enumName: 'ChargeRefundKind', description: 'CARD: back to the card. MONEY_BACK: given back in cash, Pix, bank transfer or on the card terminal (records only). CREDIT: onto the balance as credit. DISPUTE_LOST: a lost card dispute. STRIPE: refunded in the Stripe dashboard.' })
  kind!: (typeof CHARGE_REFUND_KINDS)[number];

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  refundedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only; never sent to the member.' })
  notes!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  refundedByName!: string | null;
}

/** What the owner can still refund on a payment (step 4). */
export class ChargePaymentRefundableDto {
  @ApiProperty({ description: 'What can go back to the member: to the card for a card payment, otherwise given back in cash and recorded.' })
  asMoney!: number;

  @ApiProperty({ description: 'What can be turned into credit: the part of the payment still on charges.' })
  asCredit!: number;
}

/** Backlog §3.6 step 6: the promotion fee a charge is for (Decision 300). */
export class PromotionFeeChargeDetailsDto {
  @ApiProperty({ description: 'The PromotionFeeRequest id.' })
  requestId!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty({ description: 'The style it is in.' })
  disciplineName!: string;

  @ApiProperty({ description: 'The belt or stripe it is for (also the charge description).' })
  toRungName!: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'PAID', 'DECLINED', 'WAIVED', 'CANCELLED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'PAID' | 'DECLINED' | 'WAIVED' | 'CANCELLED';
}

export type PromotionFeeChargeDetails = PromotionFeeChargeDetailsDto;

export const LATE_FEE_FOR_TYPES = ['CHARGE', 'RENEWAL'] as const;

/** Decision 413: what a late-fee charge is for. */
export class LateFeeDetailsDto {
  @ApiProperty({ enum: LATE_FEE_FOR_TYPES, description: 'CHARGE: an overdue charge. RENEWAL: a card membership renewal Stripe could not collect.' })
  forType!: (typeof LATE_FEE_FOR_TYPES)[number];

  @ApiPropertyOptional({ type: String, nullable: true, example: '#0000003', description: 'CHARGE only.' })
  forInvoiceLabel!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "CHARGE only: the overdue charge's description." })
  forDescription!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "RENEWAL only: the membership plan's title." })
  forPlanTitle!: string | null;

  @ApiProperty({ example: '2026-11-01', description: "The overdue payment's due day (a renewal's invoice date, in the School's time zone)." })
  forDueDate!: string;

  @ApiProperty({ description: 'What was still owed on it when the late fee was added (minor units).' })
  overdueAmount!: number;

  @ApiProperty()
  overdueCurrency!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The % used, in hundredths of a percent; null for a fixed fee.' })
  percentBps!: number | null;

  @ApiProperty({ description: 'Staff waived it (it is then Cancelled).' })
  waived!: boolean;
}

export type LateFeeDetails = LateFeeDetailsDto;

export class ChargePaymentAllocationDto {
  @ApiProperty()
  chargeId!: string;

  @ApiProperty({ example: '#0000001' })
  invoiceLabel!: string;

  @ApiProperty()
  amount!: number;
}

/** A desk payment: the member's receipt. */
export class ChargePaymentResponseDto {
  @ApiProperty({ description: 'The Transaction id.' })
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: CHARGE_PAYMENT_METHODS, enumName: 'ChargePaymentMethod' })
  paymentMethod!: ChargePaymentMethod;

  @ApiProperty({ enum: CHARGE_PAYMENT_CHANNELS, enumName: 'ChargePaymentChannel', description: 'Taken at the desk, paid in the app, or charged automatically to the saved card.' })
  channel!: ChargePaymentChannelValue;

  @ApiProperty({
    enum: CHARGE_PAYMENT_STATUSES,
    enumName: 'ChargePaymentStatus',
    description: 'PENDING: a card payment started in the app and not confirmed by Stripe yet (nothing is on the balance until it is). FAILED: an automatic charge that was declined.',
  })
  status!: ChargePaymentStatus;

  @ApiProperty({ description: 'Decision 406: the card surcharge paid on top, in minor units (0 = none). Not part of the balance.' })
  surchargeAmount!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The invoice the payment was made for, when it was made for one charge.' })
  invoiceLabel!: string | null;

  @ApiProperty()
  receivedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  recordedByName!: string | null;

  @ApiProperty({ type: [ChargePaymentAllocationDto], description: 'Which charges it paid.' })
  allocations!: ChargePaymentAllocationDto[];

  @ApiProperty({ description: 'The part that went onto the balance as credit when it was taken.' })
  creditAmount!: number;

  @ApiProperty({ description: 'Step 4: refunded so far, of every kind.' })
  refundedAmount!: number;

  @ApiPropertyOptional({ enum: REFUND_STATUSES, enumName: 'RefundStatus', nullable: true })
  refundStatus!: RefundStatus | null;

  @ApiProperty({ type: [ChargeRefundResponseDto], description: 'Oldest first.' })
  refunds!: ChargeRefundResponseDto[];

  @ApiPropertyOptional({ type: ChargePaymentRefundableDto, nullable: true, description: 'The owner only, for a Successful payment; null otherwise.' })
  refundable!: ChargePaymentRefundableDto | null;
}

/** Credit the owner gave (step 4). */
export class BalanceCreditResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  givenAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only; never sent to the member.' })
  note!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  givenByName!: string | null;
}

export class ChargeBalanceDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Still to pay on open charges.' })
  owed!: number;

  @ApiProperty({ description: 'Money paid and not used yet (in credit).' })
  credit!: number;

  @ApiProperty({ description: 'The balance: owed minus credit. Positive = the member owes; negative = in credit.' })
  net!: number;

  @ApiProperty({ description: 'Of what is owed, the part past its due date.' })
  overdue!: number;

  @ApiProperty({ description: 'What "Pay balance" asks for in the app: what is owed after credit (0 = nothing to pay).' })
  payableAmount!: number;

  @ApiProperty({ description: "Decision 406: the card surcharge on payableAmount when paid by card (0 = none). Member's view only; 0 for staff." })
  cardSurchargeAmount!: number;
}

export class ChargeAbilitiesDto {
  @ApiProperty()
  create!: boolean;

  @ApiProperty()
  cancel!: boolean;

  @ApiProperty()
  recordPayment!: boolean;

  @ApiProperty({ description: 'Refund a payment (owner only, Decision 303 item 3).' })
  refund!: boolean;

  @ApiProperty({ description: 'Give credit (owner only, Decision 303 item 3).' })
  addCredit!: boolean;

  @ApiProperty({ description: 'Resend a charge\'s invoice notice: whoever may create charges (Decision 338 item 5).' })
  resendInvoice!: boolean;
}

export class ChargeSettingsDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  taxCountry!: string | null;

  @ApiProperty()
  taxRateBasisPoints!: number;

  @ApiProperty()
  taxInclusive!: boolean;

  @ApiProperty()
  cancelReasonRequired!: boolean;

  @ApiProperty({ description: 'A desk payment can be recorded: the School has its payments set up.' })
  paymentsSetUp!: boolean;

  @ApiProperty({ description: 'Decision 338 item 3: notes are required when refunding.' })
  refundNotesRequired!: boolean;

  @ApiProperty({ description: 'Decision 338 item 10: the School sends payment receipts (on by default).' })
  receiptNotice!: boolean;
}

/** Decision 338 item 1 (last point): a membership's cash or bank-transfer
 * payment waiting at the desk, or one that was cancelled. Staff only, and only
 * for those who may cancel it (the owner, staff with "Can cancel charges"). */
export class DeskMembershipPaymentDto {
  @ApiProperty({ description: 'The Transaction id.' })
  id!: string;

  @ApiProperty({ enum: ['MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE', 'FREEZE_FEE'] })
  kind!: 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE' | 'FREEZE_FEE';

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The plan it is for (a freeze fee: the frozen membership\'s plan).' })
  membershipPlanTitle!: string | null;

  @ApiProperty()
  amount!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  currency!: string | null;

  @ApiProperty({ description: 'CASH, BANK_TRANSFER, PIX or CARD_TERMINAL.' })
  paymentMethod!: string;

  @ApiProperty()
  billingDate!: string;

  @ApiProperty({ enum: ['PENDING', 'CANCELLED'], description: 'CANCELLED is stored as FAILED with cancelledAt set.' })
  status!: 'PENDING' | 'CANCELLED';

  @ApiPropertyOptional({ type: String, nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  cancelledByName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  cancelReason!: string | null;
}

/** GET /schools/{schoolId}/students/{studentId}/charges: the staff view. */
export class StudentChargesResponseDto {
  @ApiProperty({ type: [ChargeBalanceDto], description: 'One per currency; usually one.' })
  balances!: ChargeBalanceDto[];

  @ApiProperty({ type: [ChargeResponseDto], description: 'What is owed first (oldest due first), then paid, then cancelled.' })
  charges!: ChargeResponseDto[];

  @ApiProperty({ type: [ChargePaymentResponseDto], description: 'Newest first.' })
  payments!: ChargePaymentResponseDto[];

  @ApiProperty({ type: [BalanceCreditResponseDto], description: 'Credit the owner gave, newest first.' })
  credits!: BalanceCreditResponseDto[];

  @ApiProperty({
    type: [DeskMembershipPaymentDto],
    description: "Decision 338 item 1: the student's membership payments by cash or bank transfer still waiting at the desk, and the ones cancelled, newest first. Empty unless the caller may cancel them.",
  })
  deskMembershipPayments!: DeskMembershipPaymentDto[];

  @ApiProperty({ type: ChargeAbilitiesDto, description: 'What the caller may do here.' })
  can!: ChargeAbilitiesDto;

  @ApiProperty({ type: ChargeSettingsDto })
  settings!: ChargeSettingsDto;
}

/** Paying in the app at one School (backlog §3.6 step 2). */
export class MemberPayInAppDto {
  @ApiProperty({ description: 'Card payments in the app are possible: the School takes Stripe payments and the account is not restricted to cash and bank transfer.' })
  available!: boolean;

  @ApiPropertyOptional({
    enum: ['NO_CARD_PAYMENTS', 'RESTRICTED'],
    enumName: 'PayInAppBlockedReason',
    nullable: true,
    description: "Why not: the School doesn't take card payments, or the account is restricted to cash and bank transfer (Decision 68).",
  })
  blockedReason!: 'NO_CARD_PAYMENTS' | 'RESTRICTED' | null;

  @ApiProperty({ description: 'The member has a saved card at this School (Decision 238).' })
  savedCard!: boolean;

  @ApiProperty({ description: '"Pay charges automatically with my saved card" is on (Decision 338 item 8).' })
  autoPay!: boolean;

  @ApiProperty({ description: 'The caller may change the automatic-payment switch: the member themselves, with a saved card here. Never a Guardian for a child, who has no saved card of their own.' })
  canSetAutoPay!: boolean;
}

export class MemberChargeSchoolDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The School's tax ID, for its invoices (Decision 338 item 6)." })
  taxId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 338 item 6: the School's address for its invoices and receipts." })
  receiptAddress!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Decision 338 item 6: the School's payment instructions for its invoices." })
  receiptPaymentInstructions!: string | null;

  @ApiProperty({ type: [ChargeBalanceDto] })
  balances!: ChargeBalanceDto[];

  @ApiProperty({ type: [ChargeResponseDto] })
  charges!: ChargeResponseDto[];

  @ApiProperty({ type: [ChargePaymentResponseDto] })
  payments!: ChargePaymentResponseDto[];

  @ApiProperty({ type: [BalanceCreditResponseDto], description: 'Credit the School gave, newest first (no note).' })
  credits!: BalanceCreditResponseDto[];

  @ApiProperty({ type: MemberPayInAppDto })
  payInApp!: MemberPayInAppDto;
}

/** GET /students/{id}/charges: the member's (or Guardian's) view, per School. */
export class MemberChargesResponseDto {
  @ApiProperty({ type: [MemberChargeSchoolDto] })
  schools!: MemberChargeSchoolDto[];
}

export class RecordChargePaymentResponseDto {
  @ApiProperty({ type: ChargePaymentResponseDto })
  payment!: ChargePaymentResponseDto;

  @ApiProperty({ type: [ChargeBalanceDto] })
  balances!: ChargeBalanceDto[];
}

export class ChargePermissionDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty({ type: [String], enum: ['BRANCH_STAFF', 'INSTRUCTOR'], isArray: true })
  roles!: Array<'BRANCH_STAFF' | 'INSTRUCTOR'>;

  @ApiProperty()
  canCreateCharges!: boolean;

  @ApiProperty()
  canCancelCharges!: boolean;
}

export class ChargePermissionListDto {
  @ApiProperty({ type: [ChargePermissionDto] })
  items!: ChargePermissionDto[];
}

export class StandardTaxRateDto {
  @ApiProperty({ example: 'GB' })
  country!: string;

  @ApiProperty({ description: 'Hundredths of a percent (2000 = 20%).' })
  rateBasisPoints!: number;

  @ApiProperty({ description: 'false: no single national rate; 0 is a placeholder and the School types its own.' })
  national!: boolean;
}

export class StandardTaxRateListDto {
  @ApiProperty({ type: [StandardTaxRateDto] })
  items!: StandardTaxRateDto[];
}


/** POST /students/{id}/charges/checkout (Decision 303 item 4). */
export class StartChargeCheckoutDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Pay this one charge. Null or missing: pay the whole balance, oldest due first.' })
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID()
  chargeId?: string | null;

  @ApiPropertyOptional({ description: 'Paying the balance: which currency, when the member owes in more than one.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;
}

export class ChargeCheckoutResponseDto {
  @ApiProperty({ description: 'The hosted Stripe Checkout page, opened in the browser.' })
  checkoutUrl!: string;

  @ApiProperty({ description: 'The Pending Transaction; it becomes Successful only from the Stripe webhook.' })
  transactionId!: string;

  @ApiProperty({ description: 'What goes toward the balance (after credit), minor units.' })
  amount!: number;

  @ApiProperty({ description: 'Decision 406: the card surcharge on top (0 = none).' })
  surchargeAmount!: number;

  @ApiProperty()
  currency!: string;
}

/** PUT /students/{id}/charge-auto-pay (Decision 338 item 8). Turning it on
 * needs the X-Step-Up-Token header (Decision 239). */
export class SetChargeAutoPayDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class ChargeAutoPayResponseDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  enabled!: boolean;
}

/** POST /schools/{schoolId}/charge-payments/{transactionId}/refund (step 4;
 * Decision 338 item 3). Owner only. */
export class RefundChargePaymentDto {
  @ApiProperty({ minimum: 1, maximum: MAX_CHARGE_MINOR, description: 'Minor units. Part refunds are allowed; never more than is left to refund on the payment.' })
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  amount!: number;

  @ApiProperty({
    enum: CHARGE_REFUND_DESTINATIONS,
    enumName: 'ChargeRefundDestination',
    description: 'CARD: back to the card (a card payment made in the app). MONEY_BACK: a desk payment given back in cash, Pix, bank transfer or on the terminal; records only. CREDIT: onto the member\'s balance as credit.',
  })
  @IsIn(CHARGE_REFUND_DESTINATIONS)
  destination!: ChargeRefundDestination;

  @ApiPropertyOptional({ maxLength: 500, description: "For staff only. Required unless the School's owner made refund notes optional." })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** POST /schools/{schoolId}/students/{studentId}/credits (step 4; Decision
 * 303 items 2 and 3). Owner only. */
export class GiveCreditDto {
  @ApiProperty({ minimum: 1, maximum: MAX_CHARGE_MINOR, description: "Minor units of the School's currency." })
  @IsInt()
  @Min(1)
  @Max(MAX_CHARGE_MINOR)
  amount!: number;

  @ApiProperty({ maxLength: 500, description: 'Why: for staff only, never shown to the member.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}

export class ChargeBalancesResponseDto {
  @ApiProperty({ type: [ChargeBalanceDto] })
  balances!: ChargeBalanceDto[];
}

export class ResendInvoiceResponseDto {
  @ApiProperty({ description: 'The invoice notice was sent again to the member (and a Guardian).' })
  sent!: boolean;
}
