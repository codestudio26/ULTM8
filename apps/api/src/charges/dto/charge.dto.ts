import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { MAX_CHARGE_MINOR } from '../charge-maths';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const CHARGE_STATUSES = ['OPEN', 'PART_PAID', 'PAID', 'CANCELLED'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Decision 338 item 9: how money was taken at the desk. */
export const DESK_CHARGE_PAYMENT_METHODS = ['CASH', 'PIX', 'BANK_TRANSFER', 'CARD_TERMINAL'] as const;
export type DeskChargePaymentMethod = (typeof DESK_CHARGE_PAYMENT_METHODS)[number];

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
}

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

  @ApiProperty({ enum: DESK_CHARGE_PAYMENT_METHODS })
  paymentMethod!: DeskChargePaymentMethod;

  @ApiProperty()
  receivedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Staff only.' })
  recordedByName!: string | null;

  @ApiProperty({ type: [ChargePaymentAllocationDto], description: 'Which charges it paid.' })
  allocations!: ChargePaymentAllocationDto[];

  @ApiProperty({ description: 'The part that went onto the balance as credit when it was taken.' })
  creditAmount!: number;
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
}

export class ChargeAbilitiesDto {
  @ApiProperty()
  create!: boolean;

  @ApiProperty()
  cancel!: boolean;

  @ApiProperty()
  recordPayment!: boolean;
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
}

/** GET /schools/{schoolId}/students/{studentId}/charges: the staff view. */
export class StudentChargesResponseDto {
  @ApiProperty({ type: [ChargeBalanceDto], description: 'One per currency; usually one.' })
  balances!: ChargeBalanceDto[];

  @ApiProperty({ type: [ChargeResponseDto], description: 'What is owed first (oldest due first), then paid, then cancelled.' })
  charges!: ChargeResponseDto[];

  @ApiProperty({ type: [ChargePaymentResponseDto], description: 'Newest first.' })
  payments!: ChargePaymentResponseDto[];

  @ApiProperty({ type: ChargeAbilitiesDto, description: 'What the caller may do here.' })
  can!: ChargeAbilitiesDto;

  @ApiProperty({ type: ChargeSettingsDto })
  settings!: ChargeSettingsDto;
}

export class MemberChargeSchoolDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The School's tax ID, for its invoices (Decision 338 item 6)." })
  taxId!: string | null;

  @ApiProperty({ type: [ChargeBalanceDto] })
  balances!: ChargeBalanceDto[];

  @ApiProperty({ type: [ChargeResponseDto] })
  charges!: ChargeResponseDto[];

  @ApiProperty({ type: [ChargePaymentResponseDto] })
  payments!: ChargePaymentResponseDto[];
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

