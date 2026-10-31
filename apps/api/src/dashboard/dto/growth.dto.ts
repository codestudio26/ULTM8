import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** GET /schools/{schoolId}/growth (backlog 5.8, Students → Growth). */
export class GrowthQueryDto {
  @ApiPropertyOptional({ description: "Only students whose home Branch is this one. Staff may only name one of their own Branches." })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class GrowthMonthDto {
  @ApiProperty({ description: "The month, YYYY-MM, in the School's time zone." })
  month!: string;

  @ApiProperty({ description: 'Students whose join date at the School (StudentJoinDate) falls in this month.' })
  newStudents!: number;

  @ApiProperty({ description: 'Students whose Subscription ended by cancellation (Membership.cancelAt) in this month, up to now.' })
  cancelled!: number;
}

export class GrowthProgrammeDto {
  @ApiProperty()
  disciplineId!: string;

  @ApiProperty({ description: "The style's name, as the School typed it." })
  name!: string;

  @ApiProperty({ description: 'Enrolled students holding a rank in this style now.' })
  students!: number;

  @ApiProperty({ type: [Number], description: 'Students who started this style (their rank in it was created) each month, in the same order as `months`.' })
  newByMonth!: number[];
}

export class GrowthResponseDto {
  @ApiProperty({ description: "The School's time zone the months are in (UTC when the School has none)." })
  timeZone!: string;

  @ApiProperty({ type: [String], nullable: true, description: "The home Branches counted; null means the whole School." })
  branchIds!: string[] | null;

  @ApiProperty({
    description: 'Active students now (Decision 317 item 5, the Dashboard\'s count): enrolled, with a Subscription, a Class Pack with credits left, a Weekly Pass or a Trial in effect.',
  })
  activeStudents!: number;

  @ApiProperty({ description: 'Enrolled students who are Visitors now (Decision 391: a visit pass and no other membership since).' })
  visitors!: number;

  @ApiProperty({ description: 'Enrolled students with a membership frozen today (Decision 404).' })
  frozen!: number;

  @ApiProperty({ type: [GrowthMonthDto], description: 'The last 12 months, oldest first; the last is the current month.' })
  months!: GrowthMonthDto[];

  @ApiProperty({ type: [GrowthProgrammeDto], description: "The School's styles that aren't archived, by name." })
  programmes!: GrowthProgrammeDto[];
}
