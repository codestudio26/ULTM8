import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /franchises/{id}/overview (Decision 450 item 1): the Franchise owner's
 * read-only totals of its member Schools. Every figure is a count or a sum;
 * nothing names or identifies a member.
 */

export class FranchiseOverviewMonthDto {
  @ApiProperty({ description: "The month, YYYY-MM (each School's months are in its own time zone)." })
  month!: string;

  @ApiProperty({ description: 'Check-ins (members and Friend Pass guests) at classes that started this month, up to now, as Students → Attendance counts them.' })
  checkIns!: number;

  @ApiProperty({ description: 'Students whose join date at the School falls in this month, as Students → Growth counts them.' })
  newStudents!: number;

  @ApiProperty({ description: 'Students whose Subscription ended by cancellation this month, up to now, as Students → Growth counts them.' })
  cancelled!: number;
}

export class FranchiseOverviewRevenueMonthDto {
  @ApiProperty({ description: 'The month, YYYY-MM.' })
  month!: string;

  @ApiProperty({ description: 'Memberships: what was kept of plan purchases and renewals (minor units).' })
  memberships!: number;

  @ApiProperty({ description: 'Charges: paid toward charges, less money given back (minor units).' })
  charges!: number;

  @ApiProperty({ description: 'Fees: late-cancellation, freeze and no-show fees kept (minor units).' })
  fees!: number;

  @ApiProperty({ description: 'Card surcharges kept (minor units).' })
  surcharges!: number;

  @ApiProperty({ description: 'memberships + charges + fees + surcharges: the billing overview\'s "Total revenue".' })
  total!: number;
}

export class FranchiseOverviewRevenueDto {
  @ApiProperty({ description: 'ISO currency code. Different currencies are never added together.' })
  currency!: string;

  @ApiProperty({ description: 'The last 12 months added up (minor units).' })
  memberships!: number;

  @ApiProperty()
  charges!: number;

  @ApiProperty()
  fees!: number;

  @ApiProperty()
  surcharges!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: [FranchiseOverviewRevenueMonthDto], description: 'Each month, oldest first.' })
  byMonth!: FranchiseOverviewRevenueMonthDto[];
}

export class FranchiseOverviewTotalsDto {
  @ApiProperty({ description: 'Enrolled students now (an active student role at the School).' })
  enrolledStudents!: number;

  @ApiProperty({ description: "Active students now: the Dashboard's and Growth's count (Decision 317 item 5, Decision 422 item 5)." })
  activeStudents!: number;

  @ApiProperty({ description: 'Check-ins over the last 30 days, as Students → Attendance counts them.' })
  checkInsLast30Days!: number;

  @ApiProperty({ type: [FranchiseOverviewMonthDto], description: 'The last 12 months, oldest first.' })
  months!: FranchiseOverviewMonthDto[];

  @ApiProperty({ type: [FranchiseOverviewRevenueDto], description: 'Revenue over the last 12 months, one entry per currency, by currency code.' })
  revenue!: FranchiseOverviewRevenueDto[];
}

export class FranchiseOverviewSchoolDto extends FranchiseOverviewTotalsDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set when the School has been closed.' })
  archivedAt!: string | null;

  @ApiProperty({ description: "The time zone the School's months and days are in (UTC when it has none)." })
  timeZone!: string;
}

export class FranchiseOverviewResponseDto {
  @ApiProperty({ type: FranchiseOverviewTotalsDto, description: "Every member School added up; revenue per currency. A month's figures add up each School's own month of that name." })
  totals!: FranchiseOverviewTotalsDto;

  @ApiProperty({ type: [FranchiseOverviewSchoolDto], description: 'The Schools that are members of the Franchise now, by name.' })
  schools!: FranchiseOverviewSchoolDto[];
}
