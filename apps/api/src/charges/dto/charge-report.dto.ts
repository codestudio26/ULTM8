import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /schools/{schoolId}/charge-reports/overview (Decision 338 item 11). */
export class ChargeOverviewQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 24, default: 12, description: 'How many months, this one included, the Paid total and revenue by month cover.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}

export class ChargeRevenueMonthDto {
  @ApiProperty({ example: '2026-10', description: "The month, in the School's time zone." })
  month!: string;

  @ApiProperty({ description: 'Payments toward charges received that month (desk, app and automatic), minor units.' })
  received!: number;

  @ApiProperty({ description: 'Money given back that month: refunds to the card or in cash, and lost disputes. Refunds as credit are not money given back.' })
  refunded!: number;

  @ApiProperty({ description: 'received − refunded.' })
  net!: number;
}

export class ChargeOverviewCurrencyDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Still owed on open charges that are not due yet (due today or later).' })
  scheduled!: number;

  @ApiProperty({ description: 'Still owed on open charges past their due date.' })
  overdue!: number;

  @ApiProperty({ description: 'Paid over the months covered, less money given back (the sum of revenue by month).' })
  paid!: number;

  @ApiProperty({ type: [ChargeRevenueMonthDto], description: 'Oldest month first.' })
  revenueByMonth!: ChargeRevenueMonthDto[];
}

export class ChargeOverviewResponseDto {
  @ApiProperty({ description: 'The months covered.' })
  months!: number;

  @ApiProperty({ description: 'false: Branch Staff, who see their own branches\' students only.' })
  wholeSchool!: boolean;

  @ApiProperty({ type: [ChargeOverviewCurrencyDto], description: 'One per currency; usually one.' })
  currencies!: ChargeOverviewCurrencyDto[];
}

export class MemberBalanceRowDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Still to pay on open charges.' })
  owed!: number;

  @ApiProperty({ description: 'In credit.' })
  credit!: number;

  @ApiProperty({ description: 'owed − credit. Positive = owes; negative = in credit.' })
  net!: number;

  @ApiProperty({ description: 'Of what is owed, the part past its due date.' })
  overdue!: number;
}

/** GET /schools/{schoolId}/charge-reports/member-balances (Decision 338 item 11). */
export class MemberBalancesResponseDto {
  @ApiProperty({ description: "false: Branch Staff, who see their own branches' students only." })
  wholeSchool!: boolean;

  @ApiProperty({ type: [MemberBalanceRowDto], description: 'Every member whose balance is not zero: owes (overdue first, most owed first), then in credit.' })
  items!: MemberBalanceRowDto[];
}
