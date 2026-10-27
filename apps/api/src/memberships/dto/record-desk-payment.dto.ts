import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { DESK_PAYMENT_METHODS, DeskPaymentMethod } from './desk-membership.dto';

/** POST /schools/{schoolId}/desk-payments (Decision 346, G7) — money the
 * School took in person, recorded so the Student's membership starts at once. */
export class RecordDeskPaymentDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiProperty()
  @IsUUID()
  membershipPlanId!: string;

  @ApiProperty({ enum: DESK_PAYMENT_METHODS })
  @IsIn(DESK_PAYMENT_METHODS)
  paymentMethod!: DeskPaymentMethod;
}

export class RecordDeskPaymentResponseDto {
  @ApiProperty({ type: String, nullable: true, description: 'Null for a free plan, which has no Transaction.' })
  transactionId!: string | null;

  @ApiProperty()
  membershipId!: string;
}

export class DeskPaymentStudentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;
}

export class DeskPaymentPlanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] })
  type!: string;

  @ApiProperty({ description: 'In hundredths of the currency.' })
  price!: number;

  @ApiProperty({ type: String, nullable: true })
  currency!: string | null;
}

export class DeskPaymentOptionsDto {
  @ApiProperty({ type: [DeskPaymentStudentDto] })
  students!: DeskPaymentStudentDto[];

  @ApiProperty({ type: [DeskPaymentPlanDto] })
  plans!: DeskPaymentPlanDto[];
}
