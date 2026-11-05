import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StudentRankSkillStatusResponseDto {
  @ApiProperty()
  skillId!: string;

  @ApiProperty()
  status!: string;
}

/**
 * GET /students/{id}/ranks response — raw StudentRank fields. GET
 * /students/{id}/eligibility returns the same plus `eligibility` (below).
 */
export class StudentRankResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  currentRankId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  currentStripeId!: string | null;

  @ApiProperty()
  dateOfCurrentRank!: string;

  @ApiProperty()
  classesAttendedTowardCheckpoint!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Classes counted toward the next rung, per class type, e.g. {"Fundamentals": 18, "Sparring": 4} (Decisions 149, 171).',
  })
  classesAttendedByType!: Record<string, number>;

  @ApiProperty({ description: 'When counting toward the current rung began: the moment of the last rank change.' })
  countingSince!: string;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'Grading Board Active/Inactive switch for this style; null follows membership (Decisions 152, 176).' })
  boardActiveOverride!: boolean | null;

  @ApiProperty({ enum: ['VERIFIED', 'UNVERIFIED'], description: 'UNVERIFIED: self-declared and waiting for staff (Decisions 137, 147).' })
  verificationStatus!: 'VERIFIED' | 'UNVERIFIED';

  @ApiPropertyOptional({ type: String, nullable: true })
  verifiedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Empty when verified automatically (the first rung) or the verifier\'s account was deleted.' })
  verifiedById!: string | null;

  @ApiProperty({ type: [StudentRankSkillStatusResponseDto] })
  skillStatuses!: StudentRankSkillStatusResponseDto[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class StudentRankListResponseDto {
  @ApiProperty({ type: [StudentRankResponseDto] })
  items!: StudentRankResponseDto[];
}

export class TypeProgressResponseDto {
  @ApiProperty()
  classType!: string;

  @ApiProperty()
  required!: number;

  @ApiProperty()
  counted!: number;
}

/** Readiness for the next rung, from the grading engine (roadmap Phase 2c).
 * With `hasNext` false only `hasNext` and `dataError` are set: the top of the
 * ladder, or (dataError) a rung that can't be found. */
export class EligibilityResponseDto {
  @ApiProperty()
  hasNext!: boolean;

  @ApiPropertyOptional({ description: 'The student\'s rung could not be found on the ladder (bad data), as opposed to the top of the ladder.' })
  dataError?: boolean;

  @ApiPropertyOptional({ description: 'The next rung (stripe tier id).' })
  nextRungId?: string;

  @ApiPropertyOptional({ description: 'The current rung is time-only: days are the only gate (Decision 128, item 3).' })
  timeOnly?: boolean;

  @ApiPropertyOptional()
  elapsedDays?: number;

  @ApiPropertyOptional()
  requiredDays?: number;

  @ApiPropertyOptional()
  requiredClasses?: number;

  @ApiPropertyOptional()
  countedClasses?: number;

  @ApiPropertyOptional({ type: [TypeProgressResponseDto], description: '"Each ticked type required" rungs only (Decision 149).' })
  byType?: TypeProgressResponseDto[];

  @ApiPropertyOptional()
  classesOk?: boolean;

  @ApiPropertyOptional()
  daysOk?: boolean;

  @ApiPropertyOptional()
  skillsOk?: boolean;

  @ApiPropertyOptional({ description: 'Hours trained the next rank needs; 0 when the style does not tick Hours.' })
  requiredHours?: number;

  @ApiPropertyOptional({ description: 'Minutes trained since the current rank date that count toward hours (0 when not asked for).' })
  minutesTrained?: number;

  @ApiPropertyOptional()
  hoursOk?: boolean;

  @ApiPropertyOptional({ description: 'Different days attended the next rank needs; 0 when the style does not tick Days attended.' })
  requiredDaysAttended?: number;

  @ApiPropertyOptional({ description: 'Different days with a check-in to a class of the style since the current rank date.' })
  daysAttended?: number;

  @ApiPropertyOptional()
  daysAttendedOk?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The next rank\'s minimum age, when the style ticks Minimum age; null = any age.' })
  minimumAge?: number | null;

  @ApiPropertyOptional({ description: 'False while the student is younger than minimumAge (or has no date of birth).' })
  ageOk?: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Every ticked requirement is met but the student is too young: "Waiting for age N". Null otherwise.' })
  waitingForAge?: number | null;

  @ApiPropertyOptional({ description: 'Every ticked requirement met, minimum age included.' })
  eligible?: boolean;

  @ApiPropertyOptional({ type: [String] })
  requiredSkillIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Shown but optional: the next rung\'s skills when the current rung is time-only.' })
  optionalSkillIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  missingSkillIds?: string[];

  @ApiPropertyOptional({ description: '0–100: the classes on their own.' })
  classesPercent?: number;

  @ApiPropertyOptional({ description: '0–100: the average of the ticked requirements the next rank asks for (classes, days in rank, skills, hours, days attended), each capped at 100%. Minimum age is not part of it. Days for a time-only rank. 100 only when every one is met.' })
  progressPercent?: number;

  @ApiPropertyOptional({ enum: ['JUST_STARTING', 'GETTING_THERE', 'READY_TO_GRADE'], description: 'Grading Board column at the default 33% / 66% (Decision 136).' })
  boardColumn?: 'JUST_STARTING' | 'GETTING_THERE' | 'READY_TO_GRADE';
}

/** Hours trained in this style at this School (Decisions 301, 306): shown as
 * information. Part of the grading % and readiness only in a style that
 * ticks Hours (Decision 321 item 2; see eligibility.minutesTrained). In whole
 * minutes; the apps show hours (90 minutes = 1.5 hours). */
export class HoursTrainedResponseDto {
  @ApiProperty({ description: 'Every minute logged in this style at this School (check-ins and "Log a class").' })
  totalMinutes!: number;

  @ApiProperty({ description: 'Minutes trained on or after the current rank date.' })
  sinceCurrentRankMinutes!: number;
}

export class ClassesProgressResponseDto {
  @ApiProperty({ description: 'Classes counted toward the next rank (eligibility.countedClasses).' })
  counted!: number;

  @ApiProperty()
  required!: number;

  @ApiProperty({ description: '0–100: the classes on their own (eligibility.classesPercent).' })
  percent!: number;

  @ApiProperty({ type: [TypeProgressResponseDto], description: '"Each ticked type required" rungs only; otherwise empty.' })
  byType!: TypeProgressResponseDto[];
}

export class DaysProgressResponseDto {
  @ApiProperty({ description: 'Days at the current rank.' })
  elapsed!: number;

  @ApiProperty({ description: 'Minimum days at the rank.' })
  required!: number;

  @ApiProperty({ description: '0–100, capped. 100 when no minimum is set.' })
  percent!: number;
}

export class SkillsProgressResponseDto {
  @ApiProperty({ description: 'Required skills signed off.' })
  signedOff!: number;

  @ApiProperty({ description: 'Required skills for the next rank.' })
  required!: number;

  @ApiProperty({ description: '0–100. 100 when none are required.' })
  percent!: number;
}

export class HoursProgressResponseDto {
  @ApiProperty({ description: 'Minutes trained since the current rank date that count toward hours.' })
  trainedMinutes!: number;

  @ApiProperty({ description: 'Hours the next rank needs.' })
  requiredHours!: number;

  @ApiProperty({ description: '0–100, capped. 100 when none are required.' })
  percent!: number;
}

export class DaysAttendedProgressResponseDto {
  @ApiProperty({ description: 'Different days attended since the current rank date.' })
  attended!: number;

  @ApiProperty()
  required!: number;

  @ApiProperty({ description: '0–100, capped. 100 when none are required.' })
  percent!: number;
}

export class MinimumAgeProgressResponseDto {
  @ApiProperty({ description: 'The next rank\'s minimum age.' })
  age!: number;

  @ApiProperty({ description: 'The student has reached it.' })
  met!: boolean;
}

/** Each requirement the style ticks, on its own, for the student page's
 * breakdown (Decisions 301 item 4, 306 item 4, 321). Taken from
 * `eligibility`, so it always agrees with it. */
export class ProgressBreakdownResponseDto {
  @ApiPropertyOptional({ type: ClassesProgressResponseDto, nullable: true, description: 'null on a time-only rank, or when the style does not tick Classes.' })
  classes!: ClassesProgressResponseDto | null;

  @ApiPropertyOptional({ type: DaysProgressResponseDto, nullable: true, description: 'Always on a time-only rank; otherwise null when the style does not tick Days in rank.' })
  days!: DaysProgressResponseDto | null;

  @ApiPropertyOptional({ type: SkillsProgressResponseDto, nullable: true, description: 'null on a time-only rank, or when the style does not tick Skills.' })
  skills!: SkillsProgressResponseDto | null;

  @ApiPropertyOptional({ type: HoursProgressResponseDto, nullable: true, description: 'Only in a style that ticks Hours.' })
  hours!: HoursProgressResponseDto | null;

  @ApiPropertyOptional({ type: DaysAttendedProgressResponseDto, nullable: true, description: 'Only in a style that ticks Days attended.' })
  daysAttended!: DaysAttendedProgressResponseDto | null;

  @ApiPropertyOptional({ type: MinimumAgeProgressResponseDto, nullable: true, description: 'Only when the next rank has a minimum age the style checks.' })
  minimumAge!: MinimumAgeProgressResponseDto | null;
}

export class StudentEligibilityResponseDto extends StudentRankResponseDto {
  @ApiProperty({ type: EligibilityResponseDto })
  eligibility!: EligibilityResponseDto;

  @ApiPropertyOptional({ type: ProgressBreakdownResponseDto, nullable: true, description: 'null when there is no next rank.' })
  progressBreakdown!: ProgressBreakdownResponseDto | null;

  @ApiProperty({ type: HoursTrainedResponseDto })
  hoursTrained!: HoursTrainedResponseDto;

  @ApiProperty({ description: 'Backlog 3.20: on a Kids style, the student has reached "Ready for Adult from age". False on other styles.' })
  readyForAdult!: boolean;
}

export class StudentEligibilityListResponseDto {
  @ApiProperty({ type: [StudentEligibilityResponseDto] })
  items!: StudentEligibilityResponseDto[];
}

/** A self-declared belt waiting to be verified (Decisions 137, 189). */
export class PendingVerificationDto {
  @ApiProperty()
  studentRankId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  disciplineName!: string;

  @ApiProperty()
  currentRankId!: string;

  @ApiProperty({ type: String, nullable: true })
  currentStripeId!: string | null;

  @ApiProperty({ enum: ['UNVERIFIED'] })
  verificationStatus!: 'UNVERIFIED';

  @ApiProperty({ description: 'When the student declared it.' })
  declaredAt!: Date;
}

export class PendingVerificationListResponseDto {
  @ApiProperty({ type: [PendingVerificationDto] })
  items!: PendingVerificationDto[];
}

/** One stripe of a style's ladder, in ladder order, for the student app. */
export class GradingLadderRungDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The stripe\'s own name, e.g. "Blue Belt · 2 Stripes".' })
  name!: string;

  @ApiProperty()
  beltName!: string;

  @ApiProperty()
  primaryColour!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  secondaryColour?: string | null;

  @ApiProperty({ description: 'Stripe colour.' })
  stripeColour!: string;

  @ApiProperty()
  stripeCount!: number;

  @ApiProperty()
  timeOnly!: boolean;

  @ApiProperty({ enum: ['BELTS', 'LEVELS'], description: 'How the style shows ranks (Decision 290). On LEVELS draw a badge in primaryColour with step of steps.' })
  rankDisplay!: 'BELTS' | 'LEVELS';

  @ApiProperty({ description: 'This rung\'s place on its rank, from 1 (step 2 of 3 on a level).' })
  step!: number;

  @ApiProperty({ description: 'How many rungs its rank has.' })
  steps!: number;
}

export class GradingSkillDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['NOT_STARTED', 'LEARNING', 'SIGNED_OFF'] })
  status!: string;

  @ApiProperty({ description: 'Required for the next grade; false when optional (time-only stripes).' })
  required!: boolean;
}

/** Decision 318 item 7: the grading countdown, when the School turns it on. */
export class GradingCountdownDto {
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, description: "The School's next grading day, only when it is today or later." })
  nextGradingDate!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Whole days until that day in the School's time zone (0 = today)." })
  daysUntilGrading!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Classes still needed for the next rank; null on a time-only rank or with no next rank.' })
  classesToGo!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Days still needed for the next rank; null with no next rank.' })
  daysToGo!: number | null;
}

/** A student's grading in one style at one School: what the student app shows
 * read-only to the student and their guardians (Decisions 132, 142, 155, 161). */
export class StudentGradingStyleDto {
  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  disciplineName!: string;

  @ApiProperty({ description: 'The School no longer teaches this style (Decision 309): the belt and history stay, nothing to work toward (no skills; the app hides progress).' })
  archived!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  currentStripeId?: string | null;

  @ApiProperty()
  dateOfCurrentRank!: Date;

  @ApiProperty({ enum: ['VERIFIED', 'UNVERIFIED'] })
  verificationStatus!: 'VERIFIED' | 'UNVERIFIED';

  @ApiProperty({ type: [GradingLadderRungDto] })
  ladder!: GradingLadderRungDto[];

  @ApiProperty({ type: EligibilityResponseDto })
  eligibility!: EligibilityResponseDto;

  @ApiPropertyOptional({ type: ProgressBreakdownResponseDto, nullable: true, description: 'null when there is no next rank.' })
  progressBreakdown!: ProgressBreakdownResponseDto | null;

  @ApiProperty({ type: HoursTrainedResponseDto })
  hoursTrained!: HoursTrainedResponseDto;

  @ApiProperty({ type: [GradingSkillDto], description: 'The skills for the next grade.' })
  skills!: GradingSkillDto[];

  @ApiPropertyOptional({ type: GradingCountdownDto, nullable: true, description: 'Decision 318 item 7: null unless the School turns the grading countdown on.' })
  countdown!: GradingCountdownDto | null;
}

export class StudentGradingOverviewResponseDto {
  @ApiProperty({ type: [StudentGradingStyleDto] })
  items!: StudentGradingStyleDto[];
}

/** A rung offered when a student declares their belt (Decision 137). */
export class DeclareRungDto extends GradingLadderRungDto {
  @ApiProperty({ description: 'The belt (Rank) this rung belongs to; send it with the rung id to declare.' })
  rankId!: string;
}

export class DeclareStyleOptionDto {
  @ApiProperty()
  disciplineId!: string;

  @ApiProperty()
  disciplineName!: string;

  @ApiProperty({ type: [DeclareRungDto], description: 'Lowest first. The first rung is the plain first belt, verified automatically (Decision 147).' })
  ladder!: DeclareRungDto[];
}

export class DeclareOptionsResponseDto {
  @ApiProperty({ type: [DeclareStyleOptionDto], description: 'Styles the student has no rank in yet. Empty while the School has ranks switched off.' })
  items!: DeclareStyleOptionDto[];
}
