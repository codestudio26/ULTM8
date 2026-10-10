import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsUUID, ValidateIf, ValidateNested } from 'class-validator';

/** The seven toggles of a grading permission, per person per style
 * (Decision 181). Each covers its own grading actions. */
export const PERMISSION_TOGGLES = [
  'canPromote',
  'canDowngrade',
  'canSignOffSkills',
  'canAdjustProgress',
  'canVerifyRanks',
  'canVoidHistory',
  'canChangeBoardThresholds',
] as const;
export type PermissionToggle = (typeof PERMISSION_TOGGLES)[number];

/** One style for one staff member, with what they may do in it. */
export class StylePermissionInputDto {
  @ApiProperty()
  @IsUUID('4')
  disciplineId!: string;

  @ApiProperty({ description: 'Promote: grade up, stripe award, bulk promote, give a first rank.' })
  @IsBoolean()
  canPromote!: boolean;

  @ApiProperty({ description: 'Move down (downgrade), with a reason.' })
  @IsBoolean()
  canDowngrade!: boolean;

  @ApiProperty({ description: 'Sign off skills.' })
  @IsBoolean()
  canSignOffSkills!: boolean;

  @ApiProperty({ description: 'Adjust progress: move a student on the Grading Board, log a class, correct the rank date, the Active switch.' })
  @IsBoolean()
  canAdjustProgress!: boolean;

  @ApiProperty({ description: 'Verify (or correct) self-declared ranks.' })
  @IsBoolean()
  canVerifyRanks!: boolean;

  @ApiProperty({ description: 'Void history entries.' })
  @IsBoolean()
  canVoidHistory!: boolean;

  @ApiProperty({ description: "Change the style's Grading Board percentages." })
  @IsBoolean()
  canChangeBoardThresholds!: boolean;
}

/** PUT /schools/{schoolId}/grading-permissions/{userId}: this staff member's
 * full set of styles and toggles. Replaces their current set; an empty list
 * removes all of it (Decisions 138, 181). Send `styles`; the older
 * `disciplineIds` still works and turns every toggle on. */
export class SetGradingPermissionsDto {
  @ApiPropertyOptional({ type: [StylePermissionInputDto], description: 'Each style this staff member may grade in, with its toggles (Decision 181).' })
  @ValidateIf((o: SetGradingPermissionsDto) => o.disciplineIds === undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StylePermissionInputDto)
  styles?: StylePermissionInputDto[];

  @ApiPropertyOptional({ type: [String], description: 'Older form: styles with every toggle on. Use `styles` instead.' })
  @ValidateIf((o: SetGradingPermissionsDto) => o.styles === undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  disciplineIds?: string[];
}

export class GradingPermissionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  disciplineId!: string;

  @ApiProperty({ type: String, nullable: true })
  grantedById!: string | null;

  @ApiProperty()
  canPromote!: boolean;

  @ApiProperty()
  canDowngrade!: boolean;

  @ApiProperty()
  canSignOffSkills!: boolean;

  @ApiProperty()
  canAdjustProgress!: boolean;

  @ApiProperty()
  canVerifyRanks!: boolean;

  @ApiProperty()
  canVoidHistory!: boolean;

  @ApiProperty()
  canChangeBoardThresholds!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class GradingStaffDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiProperty({ type: [String], description: 'INSTRUCTOR and/or BRANCH_STAFF.' })
  roles!: string[];
}

export class GradingPermissionListResponseDto {
  @ApiProperty({ type: [GradingPermissionResponseDto] })
  items!: GradingPermissionResponseDto[];

  @ApiProperty({ type: [GradingStaffDto], description: "The School's active Instructors and Branch Staff, who can be given grading permission (Decision 181)." })
  staff!: GradingStaffDto[];
}

/** The caller's own grading permissions at a School (Decision 184), for the
 * coach's screens to show only what they may do. */
export class MyGradingPermissionsResponseDto {
  @ApiProperty({ description: 'The School owner may do everything, in every style; items is then empty.' })
  isOwner!: boolean;

  @ApiProperty({ type: [GradingPermissionResponseDto] })
  items!: GradingPermissionResponseDto[];
}
