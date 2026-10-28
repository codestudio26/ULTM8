import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Decision 374 — the setup checklist's steps (Decision 318 item 1), in order. */
export enum SetupStepKey {
  BRANCH = 'BRANCH',
  STYLE_AND_BELTS = 'STYLE_AND_BELTS',
  CLASS = 'CLASS',
  MEMBERSHIP_PLAN = 'MEMBERSHIP_PLAN',
  WAIVER = 'WAIVER',
  STRIPE = 'STRIPE',
  STAFF = 'STAFF',
}

export class SetupStepDto {
  @ApiProperty({ enum: SetupStepKey, enumName: 'SetupStepKey' })
  key!: SetupStepKey;

  @ApiProperty()
  done!: boolean;
}

export class SetupChecklistDto {
  /** The owner hid it (School.setupChecklistHiddenAt). */
  @ApiProperty()
  hidden!: boolean;

  @ApiProperty({ type: [SetupStepDto] })
  steps!: SetupStepDto[];
}

/** GET /schools/:schoolId/dashboard — Decision 374, School Owner only. */
export class DashboardOverviewDto {
  /** Students with a current membership (Decision 317 item 5): a Subscription,
   * a Class Pack with credits left, a Weekly Pass or a Trial that's in effect.
   * Friend Passes (guests) don't count. Whole School. */
  @ApiProperty()
  activeStudents!: number;

  @ApiProperty({ type: SetupChecklistDto })
  setupChecklist!: SetupChecklistDto;
}

export class UpdateSetupChecklistDto {
  @ApiProperty()
  @IsBoolean()
  hidden!: boolean;
}

export class BirthdayDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  /** The day this week the birthday falls on, YYYY-MM-DD. Never the year of
   * birth or the age (Decision 318 item 2). */
  @ApiProperty()
  date!: string;
}

/** GET /schools/:schoolId/birthdays — Decision 374: this week's birthdays. */
export class BirthdaysResponseDto {
  @ApiProperty({ description: 'The week, YYYY-MM-DD, Monday to Sunday in the School\'s time zone.' })
  from!: string;

  @ApiProperty()
  to!: string;

  /** Today in the School's time zone, YYYY-MM-DD, so the portal can say "Today". */
  @ApiProperty()
  today!: string;

  @ApiProperty({ type: [BirthdayDto] })
  items!: BirthdayDto[];
}
